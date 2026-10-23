import type { QueryRangeData, Series } from './types';

export type RangeKey = '15m' | '1h' | '6h' | '24h' | '7d';

export const RANGES: { key: RangeKey; label: string; ms: number }[] = [
  { key: '15m', label: '15m', ms: 15 * 60_000 },
  { key: '1h', label: '1h', ms: 60 * 60_000 },
  { key: '6h', label: '6h', ms: 6 * 60 * 60_000 },
  { key: '24h', label: '24h', ms: 24 * 60 * 60_000 },
  { key: '7d', label: '7d', ms: 7 * 24 * 60 * 60_000 },
];

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export function rangeFor(key: RangeKey, now = Date.now()): TimeRange {
  const ms = RANGES.find((r) => r.key === key)!.ms;
  return { startMs: now - ms, endMs: now };
}

/** A time window: a preset, a duration back from now, or fixed bounds (what a pasted explorer link carries). */
export type RangeSpec = { key: RangeKey } | { lastMs: number } | { startMs: number; endMs: number };

export function resolveRange(spec: RangeSpec, now = Date.now()): TimeRange {
  if ('key' in spec) return rangeFor(spec.key, now);
  if ('lastMs' in spec) return { startMs: now - spec.lastMs, endMs: now };
  return spec;
}

/** Route params (`last` in ms, or `from`/`to` in epoch ms) as a RangeSpec; a duration matching a preset becomes that preset. */
export function rangeSpecFromParams(p: { last?: string; from?: string; to?: string }): RangeSpec | null {
  const from = Number(p.from);
  const to = Number(p.to);
  if (p.from && p.to && Number.isFinite(from) && Number.isFinite(to) && to > from) return { startMs: from, endMs: to };
  const last = Number(p.last);
  if (!p.last || !Number.isFinite(last) || last <= 0) return null;
  const preset = RANGES.find((r) => r.ms === last);
  return preset ? { key: preset.key } : { lastMs: last };
}

/**
 * The window for a live view: a preset or a duration ends now, and so does a fixed window (from a pasted link) of the same
 * length. Otherwise "Live" on a link with absolute bounds would keep asking for the same stretch of history.
 */
export function rollingRange(spec: RangeSpec, now = Date.now()): TimeRange {
  if ('startMs' in spec) return { startMs: now - (spec.endMs - spec.startMs), endMs: now };
  return resolveRange(spec, now);
}

export function describeRange(spec: RangeSpec): string {
  if ('key' in spec) return `Last ${spec.key}`;
  if ('lastMs' in spec) {
    const mins = Math.round(spec.lastMs / 60_000);
    if (mins < 60) return `Last ${mins}m`;
    if (mins < 60 * 48) return `Last ${Math.round(mins / 60)}h`;
    return `Last ${Math.round(mins / 1440)}d`;
  }
  const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${fmt(spec.startMs)} – ${fmt(spec.endMs)}`;
}

/** Roughly 60 points across the range, snapped to a step ClickHouse is happy with. */
export function stepSeconds({ startMs, endMs }: TimeRange): number {
  const raw = (endMs - startMs) / 1000 / 60;
  const steps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
  return steps.find((s) => s >= raw) ?? 14400;
}

/** Quotes a value for a SigNoz filter expression. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function body(range: TimeRange, requestType: 'raw' | 'scalar' | 'time_series', queries: unknown[]) {
  return {
    schemaVersion: 'v1',
    start: Math.floor(range.startMs),
    end: Math.floor(range.endMs),
    requestType,
    compositeQuery: { queries },
  };
}

export const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_TEXTS: Record<LogLevel, string[]> = {
  ERROR: ['ERROR', 'error', 'Error', 'ERR', 'FATAL', 'fatal', 'CRITICAL', 'critical'],
  WARN: ['WARN', 'warn', 'Warn', 'WARNING', 'warning', 'Warning'],
  INFO: ['INFO', 'info', 'Info'],
  DEBUG: ['DEBUG', 'debug', 'Debug', 'TRACE', 'trace'],
};

export interface LogFilter {
  text?: string;
  /** Structured filter expression (the chips); ANDed with `text`. */
  expression?: string;
  levels?: LogLevel[];
  service?: string;
  id?: string;
}

export function logFilterExpression(f: LogFilter): string {
  const parts: string[] = [];
  if (f.id) parts.push(`id = ${quote(f.id)}`);
  if (f.expression?.trim()) parts.push(`(${f.expression.trim()})`);
  if (f.text?.trim()) parts.push(`body CONTAINS ${quote(f.text.trim())}`);
  if (f.levels?.length) {
    const texts = f.levels.flatMap((l) => LEVEL_TEXTS[l]);
    parts.push(`severity_text IN (${texts.map(quote).join(', ')})`);
  }
  if (f.service) parts.push(`service.name = ${quote(f.service)}`);
  return parts.join(' AND ');
}

export function logsQuery(range: TimeRange, filter: LogFilter, limit: number, offset: number) {
  return body(range, 'raw', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'logs',
        filter: { expression: logFilterExpression(filter) },
        limit,
        offset,
        order: [
          { key: { name: 'timestamp' }, direction: 'desc' },
          { key: { name: 'id' }, direction: 'desc' },
        ],
      },
    },
  ]);
}

/** Per-service call count, error count and p99, grouped by service. `entryOnly` limits to spans that start a request. */
export function servicesQuery(range: TimeRange, entryOnly: boolean) {
  return body(range, 'scalar', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'traces',
        filter: { expression: entryOnly ? "kind_string IN ('Server', 'Consumer')" : '' },
        aggregations: [
          { expression: 'count()', alias: 'calls' },
          { expression: 'countIf(has_error = true)', alias: 'errors' },
          { expression: 'p99(duration_nano)', alias: 'p99' },
        ],
        groupBy: [{ name: 'service.name', fieldContext: 'resource' }],
        order: [{ key: { name: 'calls' }, direction: 'desc' }],
        limit: 100,
      },
    },
  ]);
}

export function serviceSeriesQuery(range: TimeRange, service: string, entryOnly: boolean) {
  const filter = [`service.name = ${quote(service)}`, entryOnly ? "kind_string IN ('Server', 'Consumer')" : '']
    .filter(Boolean)
    .join(' AND ');
  return body(range, 'time_series', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'traces',
        stepInterval: stepSeconds(range),
        filter: { expression: filter },
        aggregations: [
          { expression: 'count()', alias: 'calls' },
          { expression: 'countIf(has_error = true)', alias: 'errors' },
          { expression: 'p99(duration_nano)', alias: 'p99' },
        ],
      },
    },
  ]);
}

export function topOperationsQuery(range: TimeRange, service: string) {
  return body(range, 'scalar', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'traces',
        filter: { expression: `service.name = ${quote(service)}` },
        aggregations: [
          { expression: 'count()', alias: 'calls' },
          { expression: 'countIf(has_error = true)', alias: 'errors' },
          { expression: 'p99(duration_nano)', alias: 'p99' },
        ],
        groupBy: [{ name: 'name', fieldContext: 'span' }],
        order: [{ key: { name: 'calls' }, direction: 'desc' }],
        limit: 20,
      },
    },
  ]);
}

export function errorSpansQuery(range: TimeRange, service: string) {
  return body(range, 'raw', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'traces',
        filter: { expression: `service.name = ${quote(service)} AND has_error = true` },
        limit: 20,
        offset: 0,
        order: [{ key: { name: 'timestamp', fieldContext: 'span' }, direction: 'desc' }],
      },
    },
  ]);
}

/** Per-group span count, error count and p99 for an explorer filter, grouped by the given attributes, biggest first. */
export function spanGroupsQuery(range: TimeRange, expression: string, groupBy: string[]) {
  return body(range, 'scalar', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'traces',
        filter: { expression },
        aggregations: [
          { expression: 'count()', alias: 'count' },
          { expression: 'countIf(has_error = true)', alias: 'errors' },
          { expression: 'p99(duration_nano)', alias: 'p99' },
        ],
        groupBy: groupBy.map((name) => ({ name })),
        order: [{ key: { name: 'count' }, direction: 'desc' }],
        limit: 50,
      },
    },
  ]);
}

export type SpanSort = 'latest' | 'slowest';

/** Spans matching an explorer filter, newest first or slowest first, one page at a time. */
export function spanListQuery(range: TimeRange, expression: string, limit: number, offset = 0, sort: SpanSort = 'latest') {
  return body(range, 'raw', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'traces',
        filter: { expression },
        selectFields: ['service.name', 'name', 'duration_nano', 'trace_id', 'span_id', 'has_error', 'status_message', 'http.route', 'http.response.status_code'].map((name) => ({ name })),
        limit,
        offset,
        // span_id breaks ties (equal durations or timestamps are common), or offset paging can repeat or skip spans.
        order: [
          sort === 'slowest'
            ? { key: { name: 'duration_nano', fieldContext: 'span' }, direction: 'desc' }
            : { key: { name: 'timestamp', fieldContext: 'span' }, direction: 'desc' },
          { key: { name: 'span_id', fieldContext: 'span' }, direction: 'desc' },
        ],
      },
    },
  ]);
}

/** Every span of one trace, as bare rows. A fallback for servers without the waterfall endpoint. */
export function traceSpansQuery(range: TimeRange, traceId: string, limit: number) {
  return body(range, 'raw', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'traces',
        filter: { expression: `trace_id = ${quote(traceId)}` },
        selectFields: ['span_id', 'parent_span_id', 'name', 'service.name', 'duration_nano', 'has_error', 'status_message', 'kind_string'].map((name) => ({ name })),
        limit,
        offset: 0,
        order: [{ key: { name: 'timestamp', fieldContext: 'span' }, direction: 'asc' }],
      },
    },
  ]);
}

export type MetricKind = 'gauge' | 'sum' | 'histogram' | 'summary' | 'exponentialhistogram' | string;

/** One way to aggregate a metric: SigNoz's time aggregation (per series, per step) then space aggregation (across series). */
export interface MetricAggregation {
  key: string;
  label: string;
  time?: string;
  space: string;
}

const isHistogram = (kind: MetricKind) => kind === 'histogram' || kind === 'exponentialhistogram';

/** What can sensibly be asked of a metric of this type, first entry being the default. */
export function metricAggregations(kind: MetricKind, monotonic?: boolean): MetricAggregation[] {
  if (isHistogram(kind)) {
    return ['p99', 'p95', 'p90', 'p50'].map((p) => ({ key: p, label: p, space: p }));
  }
  if (kind === 'sum' && monotonic !== false) {
    return [
      { key: 'rate', label: 'Rate', time: 'rate', space: 'sum' },
      { key: 'increase', label: 'Increase', time: 'increase', space: 'sum' },
    ];
  }
  if (kind === 'sum') {
    return [
      { key: 'avg', label: 'Avg', time: 'avg', space: 'sum' },
      { key: 'max', label: 'Max', time: 'max', space: 'sum' },
      { key: 'latest', label: 'Latest', time: 'latest', space: 'sum' },
    ];
  }
  return [
    { key: 'latest', label: 'Latest', time: 'latest', space: 'avg' },
    { key: 'avg', label: 'Avg', time: 'avg', space: 'avg' },
    { key: 'max', label: 'Max', time: 'max', space: 'max' },
    { key: 'min', label: 'Min', time: 'min', space: 'min' },
  ];
}

/** A label to split a metric by, with the context SigNoz needs to find it (resource or attribute). */
export interface MetricGroup {
  name: string;
  context: string;
}

export function metricSeriesQuery(
  range: TimeRange,
  metricName: string,
  kind: MetricKind,
  options: { monotonic?: boolean; groupBy?: MetricGroup; aggregation?: string } = {},
) {
  const choices = metricAggregations(kind, options.monotonic);
  const chosen = choices.find((c) => c.key === options.aggregation) ?? choices[0];
  const aggregation: Record<string, string> = { metricName, spaceAggregation: chosen.space };
  if (chosen.time) aggregation.timeAggregation = chosen.time;
  return body(range, 'time_series', [
    {
      type: 'builder_query',
      spec: {
        name: 'A',
        signal: 'metrics',
        stepInterval: stepSeconds(range),
        aggregations: [aggregation],
        ...(options.groupBy ? { groupBy: [{ name: options.groupBy.name, fieldContext: options.groupBy.context || 'resource' }] } : {}),
        limit: 10,
      },
    },
  ]);
}

// ---- response parsing ------------------------------------------------------------------------

type Json = Record<string, unknown>;

function firstResult(resp: QueryRangeData | undefined): Json | undefined {
  const r = resp?.data?.results?.[0];
  return r && typeof r === 'object' ? (r as Json) : undefined;
}

export interface RawRow {
  timestamp: string;
  data: Json;
}

export function parseRawRows(resp: QueryRangeData | undefined): RawRow[] {
  const rows = firstResult(resp)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = row as { timestamp?: string; data?: Json };
    return { timestamp: r.timestamp ?? '', data: r.data ?? {} };
  });
}

interface Column {
  name: string;
  columnType?: string;
  aggregationIndex?: number;
}

/**
 * Scalar results come back as columns plus positional rows. Aggregation columns are keyed by the alias
 * we asked for when the server echoes it, and by aggregation order (`agg0`, `agg1`, ...) when it does not.
 */
export function parseScalarRows(resp: QueryRangeData | undefined, aliases: string[] = []): Record<string, unknown>[] {
  const result = firstResult(resp);
  const columns = result?.columns;
  const data = result?.data;
  if (!Array.isArray(columns) || !Array.isArray(data)) return [];

  const cols = columns as Column[];
  const aggregations = cols
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.columnType === 'aggregation')
    .sort((a, b) => (a.c.aggregationIndex ?? 0) - (b.c.aggregationIndex ?? 0));
  const aggKeyByColumn = new Map<number, string>();
  aggregations.forEach(({ i }, n) => aggKeyByColumn.set(i, aliases[n] ?? `agg${n}`));

  return (data as unknown[][]).map((row) => {
    const out: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      out[aggKeyByColumn.get(i) ?? c.name] = row[i];
    });
    return out;
  });
}

export interface GroupedRow {
  /** Grouping columns by field name, with the types and nulls the server sent. */
  groups: Record<string, unknown>;
  /** Aggregation columns by the alias asked for. A separate namespace: a field called `errors` must not collide with the stat. */
  stats: Record<string, unknown>;
}

/** Scalar results with group-by, kept apart so a grouping field can never be overwritten by an aggregation of the same name. */
export function parseGroupedRows(resp: QueryRangeData | undefined, aliases: string[] = []): GroupedRow[] {
  const result = firstResult(resp);
  const columns = result?.columns;
  const data = result?.data;
  if (!Array.isArray(columns) || !Array.isArray(data)) return [];
  const cols = columns as Column[];
  return (data as unknown[][]).map((row) => {
    const groups: Record<string, unknown> = {};
    const stats: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      if (c.columnType === 'aggregation') {
        const n = c.aggregationIndex ?? 0;
        stats[aliases[n] ?? `agg${n}`] = row[i];
      } else groups[c.name] = row[i];
    });
    return { groups, stats };
  });
}

interface RawSeriesValue {
  timestamp: number;
  value: number;
  partial?: boolean;
}

export function parseTimeSeries(resp: QueryRangeData | undefined, aliases: string[] = []): Series[] {
  const aggregations = firstResult(resp)?.aggregations;
  if (!Array.isArray(aggregations)) return [];
  const out: Series[] = [];
  aggregations.forEach((agg, position) => {
    const a = agg as {
      index?: number;
      alias?: string;
      series?: { labels?: { key?: { name?: string }; value?: unknown }[]; values?: RawSeriesValue[] }[];
    };
    // A real SigNoz does not return aggregations in request order, so name them by the index each one carries.
    const n = typeof a.index === 'number' ? a.index : position;
    for (const s of a.series ?? []) {
      const labels: Record<string, string> = {};
      for (const l of s.labels ?? []) {
        if (l.key?.name) labels[l.key.name] = String(l.value);
      }
      const labelText = Object.values(labels).join(' · ');
      out.push({
        name: aliases[n] || labelText || a.alias || 'value',
        labels,
        points: (s.values ?? [])
          .filter((v) => !v.partial && Number.isFinite(v.value))
          .map((v) => ({ t: v.timestamp, v: v.value }))
          // ...nor are buckets in time order; a chart needs them sorted.
          .sort((x, y) => x.t - y.t),
      });
    }
  });
  return out;
}
