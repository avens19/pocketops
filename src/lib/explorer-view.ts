import { clausesToExpression, parseExpression } from './filters';
import type { ExplorerSignal } from './explorer-state';
import { logsQuery, spanListQuery, quote, type SpanSort } from './signoz/queries';
import { viewSpecFromQuery, type SavedView, type ViewSpec } from './signoz/views';

export interface ExplorerView {
  source: ExplorerSignal;
  expression: string;
  text: string;
  rootOnly: boolean;
  errorsOnly: boolean;
  sort: SpanSort;
  groupBy: string[];
  baseline: ViewSpec;
  aggregate?: ViewSpec;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const empty = (value: unknown) => value == null || (Array.isArray(value) && value.length === 0);

/** Only use the normal explorers when their query controls can represent the entire saved query. */
export function asExplorerView(view: SavedView): ExplorerView | null {
  if (view.schemaVersion !== 'v2' || (view.source !== 'logs' && view.source !== 'traces') || view.spec.queries.length !== 1) return null;
  const query = view.spec.queries[0];
  if (query.type !== 'builder_query' || query.spec.signal !== view.source || query.spec.disabled === true) return null;
  const q = query.spec;
  const known = new Set(['name', 'signal', 'filter', 'limit', 'offset', 'order', 'selectFields', 'disabled', 'groupBy', 'aggregations', 'stepInterval', 'legend', 'source', 'secondaryAggregations', 'functions']);
  if (Object.keys(q).some((key) => !known.has(key))) return null;
  // SigNoz serializes absent query options as null (and the default source as an empty string).
  // Accept those defaults without admitting active functions, secondary aggregations or another source.
  if ((q.source != null && q.source !== '') || !empty(q.secondaryAggregations) || !empty(q.functions)) return null;
  if (q.offset != null && q.offset !== 0) return null;
  const filter = q.filter as { expression?: unknown } | undefined;
  if (filter && (typeof filter !== 'object' || Object.keys(filter).some((k) => k !== 'expression') || (filter.expression !== undefined && typeof filter.expression !== 'string'))) return null;
  const clauses = parseExpression(typeof filter?.expression === 'string' ? filter.expression : '');
  let rootOnly = false;
  let errorsOnly = false;
  let text = '';
  const remaining = clauses.filter((clause) => {
    if (clause.kind !== 'filter') return true;
    if (view.source === 'traces' && clause.op === '=' && clause.value === true) {
      if (clause.key === 'isRoot') { rootOnly = true; return false; }
      if (clause.key === 'has_error') { errorsOnly = true; return false; }
    }
    if (!text && clause.key === (view.source === 'logs' ? 'body' : 'name') && clause.op === 'CONTAINS' && typeof clause.value === 'string' && clause.value && clause.value === clause.value.trim()) {
      text = clause.value; return false;
    }
    return true;
  });
  const expression = clausesToExpression(remaining);
  const traceExpression = [rootOnly ? 'isRoot = true' : '', errorsOnly ? 'has_error = true' : '', expression ? `(${expression})` : '', text ? `name CONTAINS ${quote(text.trim())}` : ''].filter(Boolean).join(' AND ');
  const order = q.order as { key?: { name?: string }; direction?: string }[] | undefined;
  if (order != null && !Array.isArray(order)) return null;
  const fields = q.groupBy as { name?: unknown }[] | undefined;
  if (fields != null && (!Array.isArray(fields) || fields.some((f) => !f || typeof f.name !== 'string' || !f.name))) return null;
  const groupBy = (fields ?? []).map((f) => f.name as string);
  let sort: SpanSort = 'latest';
  const range = { startMs: 0, endMs: 1 };
  let baseline: ViewSpec;
  if (view.spec.requestType === 'raw' && view.spec.panelType === 'list') {
    if (groupBy.length || !empty(q.aggregations)) return null;
    if (order?.length) {
      const first = order[0];
      if (first?.direction !== 'desc') return null;
      if (first.key?.name === 'duration_nano' && view.source === 'traces') sort = 'slowest';
      else if (first.key?.name !== 'timestamp') return null;
      const tie = view.source === 'logs' ? 'id' : 'span_id';
      if (order.length > 2 || (order[1] && (order[1].key?.name !== tie || order[1].direction !== 'desc'))) return null;
    }
    baseline = viewSpecFromQuery(view.source, view.source === 'logs'
      ? logsQuery(range, { expression, text }, 50, 0)
      : spanListQuery(range, traceExpression, 50, 0, sort));
  } else if ((view.spec.panelType === 'table' && view.spec.requestType === 'scalar') || (view.spec.panelType === 'graph' && view.spec.requestType === 'time_series')) {
    if (!Array.isArray(q.aggregations) || !q.aggregations.length || q.aggregations.some((a) => !a || typeof a.expression !== 'string' || !a.expression.trim())) return null;
    const expressionForQuery = view.source === 'traces' ? traceExpression : (logsQuery(range, { expression, text }, 50, 0).compositeQuery.queries[0] as { spec: { filter: { expression: string } } }).spec.filter.expression;
    baseline = { ...view.spec, queries: [{ ...query, spec: { ...q, filter: { ...filter, expression: expressionForQuery } } }] };
    return { source: view.source, expression, text, rootOnly, errorsOnly, sort, groupBy, baseline, aggregate: baseline };
  } else return null;
  return { source: view.source, expression, text, rootOnly, errorsOnly, sort, groupBy, baseline };
}

/** Patch only controls actually changed locally. Preserve server query names, columns, limits and display settings. */
export function mergeExplorerView(view: SavedView, baseline: ViewSpec, current: ViewSpec): ViewSpec {
  const original = view.spec;
  const before = baseline.queries[0].spec;
  const after = current.queries[0].spec;
  const spec = { ...original.queries[0].spec };
  let changed = false;
  for (const key of ['filter', 'order', 'aggregations', 'groupBy', 'limit', 'stepInterval', 'legend'] as const) {
    if (same(before[key], after[key])) continue;
    changed = true;
    if (after[key] === undefined) delete spec[key];
    else if (key === 'filter') spec[key] = { ...(spec[key] as object), ...(after[key] as object) };
    else spec[key] = after[key];
  }
  const panelChanged = baseline.requestType !== current.requestType || baseline.panelType !== current.panelType;
  if (!changed && !panelChanged) return original;
  return { ...original,
    ...(panelChanged ? { panelType: current.panelType, requestType: current.requestType } : {}),
    queries: [{ ...original.queries[0], spec }],
  };
}
