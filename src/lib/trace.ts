/** A trace as the trace screen needs it: spans in tree (depth-first) order, each knowing its depth. */

export interface SpanEvent {
  name: string;
  timeMs: number;
  attributes: Record<string, string>;
  isError: boolean;
}

export interface TraceSpan {
  id: string;
  parentId: string;
  /** Depth in the tree; 0 for the root. */
  level: number;
  name: string;
  service: string;
  kind: string;
  startMs: number;
  durationMs: number;
  hasError: boolean;
  statusMessage: string;
  hasChildren: boolean;
  attributes: Record<string, string>;
  resources: Record<string, string>;
  events: SpanEvent[];
}

export interface TraceDetail {
  traceId: string;
  spans: TraceSpan[];
  startMs: number;
  endMs: number;
  rootService: string;
  rootName: string;
  totalSpans: number;
  errorSpans: number;
  /** The server stopped before returning every span. */
  truncated: boolean;
  /** Spans exist whose parent was never received. */
  hasMissingSpans: boolean;
}

type Json = Record<string, unknown>;

function strMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Json)) {
      if (v === null || v === undefined || v === '') continue;
      out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }
  return out;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function finish(traceId: string, spans: TraceSpan[], extra: Partial<TraceDetail> = {}): TraceDetail {
  const start = spans.length ? Math.min(...spans.map((s) => s.startMs)) : 0;
  const end = spans.length ? Math.max(...spans.map((s) => s.startMs + s.durationMs)) : 0;
  const root = spans.find((s) => s.level === 0);
  return {
    traceId,
    spans,
    startMs: start,
    endMs: end,
    rootService: root?.service ?? '',
    rootName: root?.name ?? '',
    totalSpans: spans.length,
    errorSpans: spans.filter((s) => s.hasError).length,
    truncated: false,
    hasMissingSpans: false,
    ...extra,
  };
}

/** SigNoz `POST /api/v4/traces/{id}/waterfall`: spans already flattened in tree order, with `level`. */
export function parseWaterfall(traceId: string, data: unknown): TraceDetail {
  const d = (data ?? {}) as Json;
  const raw = Array.isArray(d.spans) ? (d.spans as Json[]) : [];
  const spans: TraceSpan[] = raw.map((s) => {
    const resources = strMap(s.resource);
    const events = Array.isArray(s.events) ? (s.events as Json[]) : [];
    return {
      id: String(s.span_id ?? ''),
      parentId: String(s.parent_span_id ?? ''),
      level: num(s.level),
      name: String(s.name ?? ''),
      service: resources['service.name'] ?? String(s.service_name ?? ''),
      kind: String(s.kind_string ?? ''),
      startMs: num(s.time_unix),
      durationMs: num(s.duration_nano) / 1e6,
      hasError: s.has_error === true,
      statusMessage: String(s.status_message ?? ''),
      hasChildren: s.has_children === true,
      attributes: strMap(s.attributes),
      resources,
      events: events.map((e) => ({
        name: String(e.name ?? ''),
        timeMs: num(e.timeUnixNano) / 1e6,
        attributes: strMap(e.attributeMap),
        isError: e.isError === true,
      })),
    };
  });
  return finish(traceId, spans, {
    truncated: d.hasMore === true,
    hasMissingSpans: d.hasMissingSpans === true,
    totalSpans: num(d.totalSpansCount) || spans.length,
    errorSpans: d.totalErrorSpansCount === undefined ? spans.filter((s) => s.hasError).length : num(d.totalErrorSpansCount),
  });
}

export interface FlatSpan {
  id: string;
  parentId: string;
  name: string;
  service: string;
  kind: string;
  startMs: number;
  durationMs: number;
  hasError: boolean;
  statusMessage: string;
  attributes?: Record<string, string>;
  resources?: Record<string, string>;
}

/**
 * Builds tree order from bare spans, for servers without the waterfall endpoint. Children sort by start time.
 * A span whose parent is absent is treated as a root (and the trace is flagged as missing spans).
 */
export function buildTree(traceId: string, flat: FlatSpan[], truncated = false): TraceDetail {
  const ids = new Set(flat.map((s) => s.id));
  const children = new Map<string, FlatSpan[]>();
  const roots: FlatSpan[] = [];
  let missing = false;
  for (const s of flat) {
    if (!s.parentId) roots.push(s);
    else if (!ids.has(s.parentId)) {
      roots.push(s);
      missing = true;
    } else children.set(s.parentId, [...(children.get(s.parentId) ?? []), s]);
  }
  const byStart = (a: FlatSpan, b: FlatSpan) => a.startMs - b.startMs;
  const ordered: TraceSpan[] = [];
  const visit = (s: FlatSpan, level: number) => {
    const kids = (children.get(s.id) ?? []).sort(byStart);
    ordered.push({
      id: s.id,
      parentId: s.parentId,
      level,
      name: s.name,
      service: s.service,
      kind: s.kind,
      startMs: s.startMs,
      durationMs: s.durationMs,
      hasError: s.hasError,
      statusMessage: s.statusMessage,
      hasChildren: kids.length > 0,
      attributes: s.attributes ?? {},
      resources: s.resources ?? { 'service.name': s.service },
      events: [],
    });
    kids.forEach((k) => visit(k, level + 1));
  };
  roots.sort(byStart).forEach((r) => visit(r, 0));
  return finish(traceId, ordered, { truncated, hasMissingSpans: missing });
}

/** Spans to draw once the subtrees under `collapsed` span ids are hidden. */
export function visibleSpans(spans: TraceSpan[], collapsed: ReadonlySet<string>): TraceSpan[] {
  const out: TraceSpan[] = [];
  let hideBelow: number | null = null;
  for (const s of spans) {
    if (hideBelow !== null) {
      if (s.level > hideBelow) continue;
      hideBelow = null;
    }
    out.push(s);
    if (collapsed.has(s.id)) hideBelow = s.level;
  }
  return out;
}

/** How many spans sit under each span (for the "+3" on a collapsed row). Linear: a stack of the spans still open as we walk. */
export function descendantCounts(spans: TraceSpan[]): Map<string, number> {
  const counts = new Map<string, number>();
  // Spans are in tree order, so a span's subtree runs until the next span that is no deeper than it.
  const open: number[] = [];
  const close = (index: number, end: number) => counts.set(spans[index].id, end - index - 1);
  for (let i = 0; i < spans.length; i++) {
    while (open.length && spans[open[open.length - 1]].level >= spans[i].level) close(open.pop()!, i);
    open.push(i);
  }
  while (open.length) close(open.pop()!, spans.length);
  for (const [id, n] of counts) if (n === 0) counts.delete(id);
  return counts;
}

/** Horizontal placement of a span's bar as fractions of the whole trace. Always visible, even for sub-pixel spans. */
export function barGeometry(span: TraceSpan, trace: Pick<TraceDetail, 'startMs' | 'endMs'>): { left: number; width: number } {
  const total = Math.max(trace.endMs - trace.startMs, 0.001);
  const left = Math.min(Math.max((span.startMs - trace.startMs) / total, 0), 1);
  const width = Math.min(Math.max(span.durationMs / total, 0.004), 1 - left);
  return { left, width };
}

const PALETTE = ['#2563EB', '#E8590C', '#0E9F6E', '#9333EA', '#DB2777', '#0891B2', '#CA8A04', '#4F46E5', '#65A30D', '#DC2626'];

/** A stable colour per service name, so the same service reads the same across traces. */
export function serviceColor(service: string): string {
  let h = 0;
  for (let i = 0; i < service.length; i++) h = (h * 31 + service.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** The deepest error span: where a failure started, since errors bubble up to every ancestor. */
export function firstErrorSpan(spans: TraceSpan[]): TraceSpan | undefined {
  let best: TraceSpan | undefined;
  for (const s of spans) if (s.hasError && (!best || s.level > best.level)) best = s;
  return best;
}
