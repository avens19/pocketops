import { isValidKey } from './filters';
import { dashboardFormat, dashboardResults } from './dashboard-results';
import { dashboardPanelRequest, type DashboardPanel } from './signoz/dashboards';
import type { MetricInfo, QueryRangeData } from './signoz/types';
import type { TimeRange } from './signoz/queries';
import { validateViewSpec, type QueryEnvelope, type SavedView, type ViewSpec } from './signoz/views';

export interface MetricAggregation { metricName: string; timeAggregation?: string; spaceAggregation?: string; reduceTo?: string; alias?: string; [key: string]: unknown }
export function isMetricExplorerView(view: SavedView): boolean {
  return view.source === 'metrics' && view.schemaVersion === 'v2' && isMetricSpec(view.spec);
}
export function isMetricSpec(spec: ViewSpec): boolean {
  return ((spec.panelType === 'graph' && spec.requestType === 'time_series') || (['table', 'value'].includes(spec.panelType) && spec.requestType === 'scalar')) && spec.queries.length > 0 && spec.queries.every((q) =>
    q.type === 'builder_formula' ? typeof q.spec.expression === 'string' : q.type === 'builder_query' && q.spec.signal === 'metrics' && Array.isArray(q.spec.aggregations) && q.spec.aggregations.length > 0 && q.spec.aggregations.every((a) => typeof a?.metricName === 'string' && a.metricName.trim()));
}
export function metricPanel(spec: ViewSpec): DashboardPanel {
  return { kind: 'Panel', spec: { display: { name: spec.displayName }, plugin: { kind: spec.requestType === 'time_series' ? 'signoz/TimeSeriesPanel' : spec.panelType === 'value' ? 'signoz/NumberPanel' : 'signoz/TablePanel', spec: {} },
    queries: [{ kind: spec.requestType, spec: { name: 'A', plugin: { kind: 'signoz/CompositeQuery', spec: { queries: spec.queries } } } }],
  } };
}
export const metricViewRequest = (spec: ViewSpec, range: TimeRange) => dashboardPanelRequest(metricPanel(spec), {}, range);
export const metricViewResults = (spec: ViewSpec, data?: QueryRangeData) => dashboardResults(metricPanel(spec), data);
export function updateMetricQuery(spec: ViewSpec, index: number, patch: Record<string, unknown>): ViewSpec {
  return { ...spec, queries: spec.queries.map((q, i) => i === index ? { ...q, spec: { ...q.spec, ...patch } } : q) };
}
export function metricGrouping(query: QueryEnvelope, names: string[]) {
  if (names.some((name) => !isValidKey(name))) throw new Error('Use field names separated by commas for Group by.');
  const original = (query.spec.groupBy ?? []) as { name: string; [key: string]: unknown }[];
  return [...new Set(names)].map((name) => original.find((field) => field.name === name) ?? { name });
}
export function validateMetricSpec(spec: ViewSpec) {
  validateViewSpec(spec);
  if (!isMetricSpec(spec)) throw new Error('Use metric builder queries and formulas with a chart, table, or value panel.');
  const names = spec.queries.map((q) => q.spec.name);
  if (names.some((n) => typeof n !== 'string' || !n.trim()) || new Set(names).size !== names.length) throw new Error('Queries need unique, non-empty names.');
  if (spec.queries.every((q) => q.spec.disabled === true)) throw new Error('Show the output of at least one query or formula.');
  for (const query of spec.queries) {
    if (query.type === 'builder_formula' && !String(query.spec.expression).trim()) throw new Error('Enter a formula expression.');
    if (query.type === 'builder_query') metricGrouping(query, ((query.spec.groupBy ?? []) as { name: string }[]).map((field) => field.name));
    const limit = query.spec.limit;
    if (limit != null && (!Number.isInteger(limit) || Number(limit) < 1)) throw new Error('Group limits must be positive whole numbers, or empty for the saved default.');
  }
}
/** Infer units only when every aggregation in this query has the same known unit and rate mode. Formulas need an explicit display unit. */
export function metricQueryUnit(query: QueryEnvelope, metrics: MetricInfo[]): { unit: string; rate: boolean } | undefined {
  if (query.type !== 'builder_query') return undefined;
  const units = ((query.spec.aggregations ?? []) as MetricAggregation[]).map((a) => {
    const info = metrics.find((m) => m.name === a.metricName) ?? metrics.find((m) => `${m.name}.bucket` === a.metricName);
    return info ? { unit: info.unit, rate: a.timeAggregation === 'rate' } : undefined;
  });
  if (!units.length || units.some((u) => !u || u.unit !== units[0]?.unit || u.rate !== units[0]?.rate)) return undefined;
  return units[0];
}
export function formatMetricQuery(value: number, query: QueryEnvelope, metrics: MetricInfo[], override?: string): string {
  if (override !== undefined) return dashboardFormat(value, override);
  const inferred = metricQueryUnit(query, metrics);
  return dashboardFormat(value, inferred?.unit) + (inferred?.rate ? '/s' : '');
}
