import { SignozClient, SignozError } from './client';
import {
  type LogFilter,
  type LogLevel,
  type MetricKind,
  type RawRow,
  type TimeRange,
  errorSpansQuery,
  logsQuery,
  metricSeriesQuery,
  type MetricGroup,
  parseGroupedRows,
  parseRawRows,
  parseScalarRows,
  parseTimeSeries,
  serviceSeriesQuery,
  spanGroupsQuery,
  spanListQuery,
  type SpanSort,
  servicesQuery,
  topOperationsQuery,
  traceSpansQuery,
} from './queries';
import { parseRuleQuery, type RuleQuery } from '../rule-query';
import { buildTree, parseWaterfall, type FlatSpan, type TraceDetail } from '../trace';
import type {
  AlertState,
  FiringAlert,
  LogRow,
  MetricInfo,
  QueryRangeData,
  Rule,
  ServiceStat,
  TimelineItem,
} from './types';

type Json = Record<string, unknown>;

export function queryRange(client: SignozClient, body: unknown, signal?: AbortSignal) {
  return client.request<QueryRangeData>('/api/v5/query_range', { method: 'POST', body, signal });
}

// ---- alerts ----------------------------------------------------------------------------------

const ALERT_STATES: AlertState[] = ['firing', 'pending', 'recovering', 'nodata', 'inactive', 'disabled'];

function asState(value: unknown): AlertState {
  return ALERT_STATES.includes(value as AlertState) ? (value as AlertState) : 'inactive';
}

function asStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Json)) out[k] = String(v);
  }
  return out;
}

export function normalizeRule(raw: Json): Rule {
  const labels = asStringMap(raw.labels);
  const state = asState(raw.state);
  return {
    id: String(raw.id),
    name: String(raw.alert ?? raw.name ?? 'Untitled rule'),
    state: raw.disabled === true ? 'disabled' : state,
    severity: labels.severity,
    labels,
    alertType: typeof raw.alertType === 'string' ? raw.alertType : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    disabled: raw.disabled === true || state === 'disabled',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

/** Rule list endpoints by SigNoz generation, newest first. Each answers in a slightly different shape. */
const RULE_ENDPOINTS: { path: string; query?: Record<string, number> }[] = [
  { path: '/api/v3/rules', query: { limit: 200, offset: 0 } },
  { path: '/api/v2/rules' },
  { path: '/api/v1/rules' },
];

function extractRules(data: unknown): Json[] {
  if (Array.isArray(data)) return data as Json[];
  const rules = (data as { rules?: unknown } | undefined)?.rules;
  return Array.isArray(rules) ? (rules as Json[]) : [];
}

const SEVERITY_ORDER = ['critical', 'error', 'warning', 'info'];
const STATE_ORDER: AlertState[] = ['firing', 'pending', 'recovering', 'nodata', 'inactive', 'disabled'];

export function sortRules(rules: Rule[]): Rule[] {
  const sev = (r: Rule) => {
    const i = SEVERITY_ORDER.indexOf((r.severity ?? '').toLowerCase());
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  return [...rules].sort(
    (a, b) =>
      STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || sev(a) - sev(b) || a.name.localeCompare(b.name),
  );
}

export async function listRules(client: SignozClient, signal?: AbortSignal): Promise<Rule[]> {
  let lastError: unknown;
  for (const endpoint of RULE_ENDPOINTS) {
    try {
      const data = await client.request<unknown>(endpoint.path, { query: endpoint.query, signal });
      return sortRules(extractRules(data).map(normalizeRule));
    } catch (e) {
      if (e instanceof SignozError && e.kind === 'not-found') {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new SignozError('This SigNoz version has no alert rules endpoint the app can use.', 'not-found');
}

export async function listFiringAlerts(client: SignozClient, signal?: AbortSignal): Promise<FiringAlert[]> {
  const data = await client.request<Json[] | null>('/api/v1/alerts', { signal });
  return (data ?? []).map((a) => {
    const labels = asStringMap(a.labels);
    const status = (a.status ?? {}) as { state?: string; silencedBy?: unknown[] | null };
    return {
      fingerprint: String(a.fingerprint ?? ''),
      ruleName: labels.alertname ?? 'Alert',
      labels,
      annotations: asStringMap(a.annotations),
      startsAt: String(a.startsAt ?? ''),
      state: status.state ?? 'active',
      silenced: (status.silencedBy?.length ?? 0) > 0,
    };
  });
}

export async function ruleTimeline(
  client: SignozClient,
  ruleId: string,
  range: TimeRange,
  signal?: AbortSignal,
): Promise<TimelineItem[]> {
  const query = { start: range.startMs, end: range.endMs, limit: 50, order: 'desc' };
  const id = encodeURIComponent(ruleId);
  let data: { items?: Json[] | null } | undefined;
  try {
    data = await client.request(`/api/v2/rules/${id}/history/timeline`, { query, signal });
  } catch (e) {
    if (!(e instanceof SignozError) || e.kind !== 'not-found') throw e;
    data = await client.request(`/api/v1/rules/${id}/history/timeline`, { query, signal });
  }
  return (data?.items ?? []).map((i) => ({
    unixMilli: Number(i.unixMilli),
    state: asState(i.state),
    value: Number(i.value),
    labels: Array.isArray(i.labels)
      ? Object.fromEntries(
          (i.labels as { key?: { name?: string }; value?: unknown }[])
            .filter((l) => l.key?.name)
            .map((l) => [l.key!.name!, String(l.value)]),
        )
      : asStringMap(i.labels),
    stateChanged: i.stateChanged === true,
  }));
}

/** The query an alert rule evaluates, or null for a rule without a builder query (PromQL, ClickHouse). */
export async function fetchRuleQuery(client: SignozClient, ruleId: string, signal?: AbortSignal): Promise<RuleQuery | null> {
  const id = encodeURIComponent(ruleId);
  let data: unknown;
  try {
    data = await client.request<unknown>(`/api/v2/rules/${id}`, { signal });
  } catch (e) {
    if (!(e instanceof SignozError) || e.kind !== 'not-found') throw e;
    data = await client.request<unknown>(`/api/v1/rules/${id}`, { signal });
  }
  return parseRuleQuery(data);
}

// ---- logs ------------------------------------------------------------------------------------

function flatten(data: Json, ...keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const part = data[key];
    if (part && typeof part === 'object') {
      for (const [k, v] of Object.entries(part as Json)) {
        if (v !== null && v !== undefined && v !== '') out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
    }
  }
  return out;
}

export function toLogRow(row: RawRow): LogRow {
  const d = row.data;
  const resources = flatten(d, 'resources_string', 'resources', 'resource');
  const attributes = flatten(d, 'attributes_string', 'attributes_number', 'attributes_bool', 'attributes');
  const severity = String(d.severity_text ?? d.severity ?? '').toUpperCase();
  return {
    id: String(d.id ?? `${row.timestamp}-${String(d.body ?? '').slice(0, 24)}`),
    timestamp: row.timestamp || String(d.timestamp ?? ''),
    body: String(d.body ?? ''),
    severity,
    service: resources['service.name'] ?? (typeof d['service.name'] === 'string' ? d['service.name'] : undefined),
    traceId: typeof d.trace_id === 'string' && d.trace_id ? d.trace_id : undefined,
    attributes,
    resources,
  };
}

export const LOG_PAGE_SIZE = 50;
/** How many of the newest logs the live view keeps on screen. */
export const LIVE_LOG_LIMIT = 200;

export async function fetchLogs(
  client: SignozClient,
  range: TimeRange,
  filter: LogFilter,
  offset: number,
  signal?: AbortSignal,
  limit = LOG_PAGE_SIZE,
): Promise<LogRow[]> {
  const resp = await queryRange(client, logsQuery(range, filter, limit, offset), signal);
  return parseRawRows(resp).map(toLogRow);
}

export async function fetchLogById(client: SignozClient, id: string, signal?: AbortSignal): Promise<LogRow | undefined> {
  const now = Date.now();
  // Log ids are time-ordered but carry no timestamp we can read back, so search a generous window.
  const range = { startMs: now - 30 * 24 * 60 * 60_000, endMs: now };
  const resp = await queryRange(client, logsQuery(range, { id }, 1, 0), signal);
  const row = parseRawRows(resp)[0];
  return row ? toLogRow(row) : undefined;
}

export type { LogLevel };

// ---- services (APM) --------------------------------------------------------------------------

const STAT_ALIASES = ['calls', 'errors', 'p99'];

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** True when the server rejected the request because it does not understand the span kind filter. */
function isFilterError(e: unknown): boolean {
  return e instanceof SignozError && e.kind === 'bad-request';
}

/**
 * Entry spans (server/consumer) are the right unit for "requests", but if this SigNoz version rejects
 * the span-kind filter we fall back to counting every span rather than showing nothing.
 */
async function withEntryFallback<T>(run: (entryOnly: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(true);
  } catch (e) {
    if (!isFilterError(e)) throw e;
    return run(false);
  }
}

export function toServiceStats(resp: QueryRangeData | undefined): ServiceStat[] {
  return parseScalarRows(resp, STAT_ALIASES)
    .map((r) => ({
      name: String(r['service.name'] ?? ''),
      calls: num(r.calls),
      errors: num(r.errors),
      p99Ms: num(r.p99) / 1e6,
    }))
    .filter((s) => s.name);
}

export function fetchServices(client: SignozClient, range: TimeRange, signal?: AbortSignal): Promise<ServiceStat[]> {
  return withEntryFallback(async (entryOnly) =>
    toServiceStats(await queryRange(client, servicesQuery(range, entryOnly), signal)),
  );
}

export function fetchServiceSeries(client: SignozClient, range: TimeRange, service: string, signal?: AbortSignal) {
  return withEntryFallback(async (entryOnly) =>
    parseTimeSeries(await queryRange(client, serviceSeriesQuery(range, service, entryOnly), signal), STAT_ALIASES),
  );
}

export async function fetchTopOperations(client: SignozClient, range: TimeRange, service: string, signal?: AbortSignal) {
  const resp = await queryRange(client, topOperationsQuery(range, service), signal);
  return parseScalarRows(resp, STAT_ALIASES).map((r) => ({
    name: String(r.name ?? ''),
    calls: num(r.calls),
    errors: num(r.errors),
    p99Ms: num(r.p99) / 1e6,
  }));
}

export interface ErrorSpan {
  timestamp: string;
  name: string;
  traceId: string;
  durationMs: number;
  message: string;
}

export async function fetchErrorSpans(
  client: SignozClient,
  range: TimeRange,
  service: string,
  signal?: AbortSignal,
): Promise<ErrorSpan[]> {
  const resp = await queryRange(client, errorSpansQuery(range, service), signal);
  return parseRawRows(resp).map((r) => ({
    timestamp: r.timestamp,
    name: String(r.data.name ?? ''),
    traceId: String(r.data.trace_id ?? ''),
    durationMs: num(r.data.duration_nano) / 1e6,
    message: String(r.data.status_message ?? ''),
  }));
}

/** A grouping value as the server typed it; null (or empty) means the span has no such attribute. */
export type GroupValue = string | number | boolean | null;

export interface SpanGroup {
  /** Typed values of the grouping fields, in the order they were requested. */
  values: GroupValue[];
  /** The same, as display text (a missing value is empty). */
  labels: string[];
  count: number;
  errors: number;
  /** p99 duration in milliseconds. */
  p99Ms: number;
}

const GROUP_STATS = ['count', 'errors', 'p99'];

function asGroupValue(v: unknown): GroupValue {
  if (v === null || v === undefined || v === '') return null;
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
}

export async function fetchSpanGroups(
  client: SignozClient,
  range: TimeRange,
  expression: string,
  groupBy: string[],
  signal?: AbortSignal,
): Promise<SpanGroup[]> {
  const resp = await queryRange(client, spanGroupsQuery(range, expression, groupBy), signal);
  return parseGroupedRows(resp, GROUP_STATS).map(({ groups, stats }) => {
    // Group columns come back keyed by field name; ask for them in the order requested.
    const values = groupBy.map((name) => asGroupValue(groups[name]));
    return {
      values,
      labels: values.map((v) => (v === null ? '' : String(v))),
      count: num(stats.count),
      errors: num(stats.errors),
      p99Ms: num(stats.p99) / 1e6,
    };
  });
}

export interface SpanRow {
  timestamp: string;
  name: string;
  service: string;
  traceId: string;
  spanId: string;
  durationMs: number;
  hasError: boolean;
  message: string;
}

export const SPAN_PAGE_SIZE = 50;

export async function fetchSpans(
  client: SignozClient,
  range: TimeRange,
  expression: string,
  offset = 0,
  sort: SpanSort = 'latest',
  signal?: AbortSignal,
): Promise<SpanRow[]> {
  const resp = await queryRange(client, spanListQuery(range, expression, SPAN_PAGE_SIZE, offset, sort), signal);
  return parseRawRows(resp).map((r) => ({
    timestamp: r.timestamp,
    name: String(r.data.name ?? ''),
    service: String(r.data['service.name'] ?? r.data.serviceName ?? r.data['resource_string_service$$name'] ?? ''),
    traceId: String(r.data.trace_id ?? ''),
    spanId: String(r.data.span_id ?? ''),
    durationMs: num(r.data.duration_nano) / 1e6,
    hasError: r.data.has_error === true || r.data.has_error === 'true',
    message: String(r.data.status_message ?? ''),
  }));
}

// ---- metrics ---------------------------------------------------------------------------------

export async function listMetrics(
  client: SignozClient,
  search: string,
  range: TimeRange,
  signal?: AbortSignal,
): Promise<MetricInfo[]> {
  const data = await client.request<{ metrics?: Json[] | null }>('/api/v2/metrics', {
    query: { searchText: search || undefined, limit: 100, start: range.startMs, end: range.endMs },
    signal,
  });
  return (data.metrics ?? []).map((m) => ({
    name: String(m.metricName),
    type: String(m.type ?? ''),
    unit: String(m.unit ?? ''),
    description: String(m.description ?? ''),
    temporality: String(m.temporality ?? ''),
    isMonotonic: m.isMonotonic === true,
  }));
}

export async function fetchMetricSeries(
  client: SignozClient,
  range: TimeRange,
  metric: { name: string; type: MetricKind; isMonotonic?: boolean },
  options: { groupBy?: MetricGroup; aggregation?: string },
  signal?: AbortSignal,
) {
  const run = async (name: string) =>
    parseTimeSeries(
      await queryRange(client, metricSeriesQuery(range, name, metric.type, { monotonic: metric.isMonotonic, ...options }), signal),
    );
  const series = await run(metric.name);
  // Histograms are queried through their `.bucket` series; the list endpoint reports the base name.
  const isHistogram = metric.type === 'histogram' || metric.type === 'exponentialhistogram';
  if (series.length === 0 && isHistogram && !metric.name.endsWith('.bucket')) {
    return run(`${metric.name}.bucket`);
  }
  return series;
}

/** The labels a metric actually carries, to offer as ways to split it. Common ones first. */
export async function fetchMetricLabels(
  client: SignozClient,
  metricName: string,
  range: TimeRange,
  signal?: AbortSignal,
): Promise<MetricGroup[]> {
  const keys = await fetchFieldKeys(client, 'metrics', '', range, signal, metricName);
  const common = ['service.name', 'host.name', 'k8s.pod.name', 'k8s.namespace.name'];
  const rank = (name: string) => {
    const i = common.indexOf(name);
    return i === -1 ? common.length : i;
  };
  return keys.map((k) => ({ name: k.name, context: k.context })).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

// ---- fields (filter autocomplete) -----------------------------------------------------------

export type FieldSignal = 'logs' | 'traces' | 'metrics';

export interface FieldKey {
  name: string;
  /** resource, attribute, log, span, ... */
  context: string;
  dataType: string;
}

/** Names of the attributes seen in the window, optionally narrowed by a substring. */
export async function fetchFieldKeys(
  client: SignozClient,
  signal: FieldSignal,
  search: string,
  range: TimeRange,
  abort?: AbortSignal,
  /** For signal=metrics: the labels of this one metric. */
  metricName?: string,
): Promise<FieldKey[]> {
  const data = await client.request<{ keys?: Record<string, Json[]> | null }>('/api/v1/fields/keys', {
    query: { signal, metricName, searchText: search || undefined, limit: 40, startUnixMilli: Math.floor(range.startMs), endUnixMilli: Math.floor(range.endMs) },
    signal: abort,
  });
  const seen = new Set<string>();
  const out: FieldKey[] = [];
  for (const variants of Object.values(data?.keys ?? {})) {
    for (const k of variants) {
      const name = String(k.name ?? '');
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, context: String(k.fieldContext ?? ''), dataType: String(k.fieldDataType ?? '') });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Values seen for one field in the window, optionally narrowed by a substring. */
export async function fetchFieldValues(
  client: SignozClient,
  signal: FieldSignal,
  name: string,
  search: string,
  range: TimeRange,
  abort?: AbortSignal,
): Promise<string[]> {
  const data = await client.request<{ values?: Record<string, unknown[] | null> | null }>('/api/v1/fields/values', {
    query: { signal, name, searchText: search || undefined, limit: 30, startUnixMilli: Math.floor(range.startMs), endUnixMilli: Math.floor(range.endMs) },
    signal: abort,
  });
  const values = data?.values ?? {};
  return [...(values.stringValues ?? []), ...(values.numberValues ?? []), ...(values.boolValues ?? [])]
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(String);
}

// ---- traces ---------------------------------------------------------------------------------

const TRACE_SPAN_LIMIT = 2000;

/**
 * One trace with its spans in tree order. Uses the waterfall endpoint (which also carries attributes and events);
 * a server without it gets the bare spans from a query instead, so the screen still works with less detail.
 */
export async function fetchTrace(client: SignozClient, traceId: string, signal?: AbortSignal): Promise<TraceDetail> {
  try {
    const data = await client.request<unknown>(`/api/v4/traces/${encodeURIComponent(traceId)}/waterfall`, {
      method: 'POST',
      body: { uncollapsedSpans: [] },
      signal,
    });
    return parseWaterfall(traceId, data);
  } catch (e) {
    if (!(e instanceof SignozError) || (e.kind !== 'not-found' && e.kind !== 'bad-request')) throw e;
  }
  const now = Date.now();
  const resp = await queryRange(client, traceSpansQuery({ startMs: now - 7 * 24 * 60 * 60_000, endMs: now }, traceId, TRACE_SPAN_LIMIT), signal);
  const flat: FlatSpan[] = parseRawRows(resp).map((r) => ({
    id: String(r.data.span_id ?? ''),
    parentId: String(r.data.parent_span_id ?? ''),
    name: String(r.data.name ?? ''),
    service: String(r.data['service.name'] ?? ''),
    kind: String(r.data.kind_string ?? ''),
    startMs: Date.parse(r.timestamp) || 0,
    durationMs: num(r.data.duration_nano) / 1e6,
    hasError: r.data.has_error === true || r.data.has_error === 'true',
    statusMessage: String(r.data.status_message ?? ''),
  }));
  return buildTree(traceId, flat, flat.length >= TRACE_SPAN_LIMIT);
}
