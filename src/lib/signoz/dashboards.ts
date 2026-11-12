import { SignozClient } from './client';
import { quote, stepSeconds, type TimeRange } from './queries';
import type { QueryEnvelope } from './views';

export interface Plugin { kind: string; spec: Record<string, unknown> }
export interface DashboardVariable {
  kind: string;
  spec: { name: string; display?: { name?: string; description?: string }; defaultValue?: string | string[]; value?: string; allowMultiple?: boolean; allowAllValue?: boolean; sort?: string; plugin?: Plugin };
}
export interface DashboardPanel {
  kind: string;
  spec: {
    display?: { name?: string; description?: string };
    plugin: Plugin;
    queries: { kind: string; spec: { name: string; plugin: Plugin } }[];
  };
}
export interface Dashboard {
  id: string; name: string; schemaVersion?: string;
  spec: {
    display?: { name?: string; description?: string };
    variables?: DashboardVariable[];
    panels: Record<string, DashboardPanel>;
    layouts?: { kind: string; spec: { display?: { title?: string; collapse?: { open?: boolean } }; items?: { x?: number; y?: number; content: { $ref: string } }[] } }[];
    duration?: string;
  };
}
export type DashboardSummary = Pick<Dashboard, 'id' | 'name' | 'schemaVersion'> & { spec?: { display?: { name?: string; description?: string } } };
export const dashboardTitle = (d: DashboardSummary) => d.spec?.display?.name || d.name || 'Untitled dashboard';
export async function listDashboards(client: SignozClient, search: string, offset: number, signal?: AbortSignal) {
  return client.request<{ dashboards: DashboardSummary[]; total: number }>('/api/v2/dashboards', {
    query: { query: search.trim() ? `name CONTAINS ${quote(search.trim())}` : undefined, sort: 'name', order: 'asc', limit: 50, offset }, signal,
  });
}
export async function getDashboard(client: SignozClient, id: string, signal?: AbortSignal): Promise<Dashboard> {
  const data = await client.request<Dashboard>(`/api/v2/dashboards/${encodeURIComponent(id)}`, { signal });
  if (!data?.spec?.panels || Array.isArray(data.spec.panels)) throw new Error('This dashboard format is not supported. Open it in SigNoz.');
  return data;
}
export interface VariableValue { type: 'dynamic' | 'custom' | 'text'; value: string | string[] }
export type DashboardValues = Record<string, VariableValue>;
export function defaultVariables(variables: DashboardVariable[]): DashboardValues {
  return Object.fromEntries(variables.map(({ kind, spec: v }) => {
    if (kind === 'TextVariable') return [v.name, { type: 'text', value: v.value ?? '' }];
    const type = v.plugin?.kind === 'signoz/DynamicVariable' ? 'dynamic' : 'custom';
    const value = v.defaultValue ?? (v.allowAllValue && type === 'dynamic' ? '__all__' : v.allowMultiple ? [] : '');
    return [v.name, { type, value }];
  }));
}
export function variableProblem(variables: DashboardVariable[], values: DashboardValues): string | undefined {
  for (const { kind, spec: v } of variables) {
    if (kind !== 'TextVariable' && (kind !== 'ListVariable' || !['signoz/DynamicVariable', 'signoz/CustomVariable'].includes(v.plugin?.kind ?? ''))) return `${v.display?.name || v.name} uses an unsupported variable source. Open this dashboard in SigNoz.`;
    const value = values[v.name]?.value;
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return `Choose ${v.display?.name || v.name} to load the panels.`;
  }
}
export function sortVariableOptions(options: string[], sort = ''): string[] {
  const values = [...new Set(options)];
  if (!sort || sort === 'none') return values;
  const direction = sort.endsWith('desc') ? -1 : 1;
  return values.sort((a, b) => direction * (sort.startsWith('numerical') ? (Number(a) - Number(b) || a.localeCompare(b)) : a.localeCompare(b, undefined, { sensitivity: sort.includes('-ci-') ? 'base' : 'variant' })));
}
export async function variableOptions(client: SignozClient, variable: DashboardVariable, range: TimeRange, search: string, signal?: AbortSignal): Promise<string[]> {
  const plugin = variable.spec.plugin;
  if (plugin?.kind === 'signoz/CustomVariable') return sortVariableOptions(String(plugin.spec.customValue ?? '').split(',').map((s) => s.trim()).filter((s) => s && s.toLowerCase().includes(search.toLowerCase())), variable.spec.sort);
  if (plugin?.kind !== 'signoz/DynamicVariable') throw new Error('This variable source is not supported.');
  const data = await client.request<{ values?: Record<string, unknown[] | null> }>('/api/v1/fields/values', {
    query: { signal: String(plugin.spec.signal || 'all'), name: String(plugin.spec.name), searchText: search || undefined, limit: 200, startUnixMilli: range.startMs, endUnixMilli: range.endMs }, signal,
  });
  return sortVariableOptions(Object.values(data.values ?? {}).flatMap((values) => values ?? []).filter((v) => v != null).map(String), variable.spec.sort);
}

export function dashboardSections(d: Dashboard) {
  const used = new Set<string>();
  const sections = (d.spec.layouts ?? []).map((layout, i) => {
    const panels = [...(layout.spec.items ?? [])].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0)).flatMap((item) => {
      const ref = item.content.$ref;
      if (!ref.startsWith('#/spec/panels/')) return [];
      const id = ref.slice('#/spec/panels/'.length).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!d.spec.panels[id] || used.has(id)) return [];
      used.add(id); return [id];
    });
    return { id: `section-${i}`, title: layout.spec.display?.title || `Section ${i + 1}`, open: layout.spec.display?.collapse?.open !== false, panels };
  });
  const remaining = Object.keys(d.spec.panels).filter((id) => !used.has(id));
  if (remaining.length) sections.push({ id: 'other', title: sections.length ? 'Other panels' : 'Panels', open: true, panels: remaining });
  return sections.filter((s) => s.panels.length);
}

const PANEL_KINDS = ['signoz/TimeSeriesPanel', 'signoz/BarChartPanel', 'signoz/TablePanel', 'signoz/NumberPanel', 'signoz/TextPanel'];
export function panelQueries(panel: DashboardPanel): { requestType: 'scalar' | 'time_series'; queries: QueryEnvelope[] } {
  if (!PANEL_KINDS.includes(panel.spec.plugin.kind)) throw new Error('This panel type is not supported. Open it in SigNoz.');
  const envelopes = panel.spec.queries ?? [];
  const types = new Set(envelopes.map((q) => q.kind));
  if (types.size !== 1 || (!types.has('scalar') && !types.has('time_series'))) throw new Error('This panel query type is not supported.');
  const queries = envelopes.flatMap(({ spec: { plugin } }) => {
    if (plugin.kind === 'signoz/BuilderQuery') return [{ type: 'builder_query', spec: plugin.spec }];
    if (plugin.kind === 'signoz/CompositeQuery' && Array.isArray(plugin.spec.queries)) return plugin.spec.queries as QueryEnvelope[];
    throw new Error('This query plugin is not supported. Open it in SigNoz.');
  });
  if (!queries.length || queries.some((q) => !['builder_query', 'builder_formula'].includes(q.type))) throw new Error('This query type is not supported.');
  const names = queries.map((q) => q.spec.name);
  if (new Set(names).size !== names.length) throw new Error('This panel uses duplicate query names. Open it in SigNoz.');
  return { requestType: types.has('scalar') ? 'scalar' : 'time_series', queries };
}
export function panelRange(panel: DashboardPanel, range: TimeRange): TimeRange {
  const visualization = panel.spec.plugin.spec.visualization as { timePreference?: string } | undefined;
  const durations: Record<string, number> = { last_5_min: 300, last_15_min: 900, last_30_min: 1800, last_1_hr: 3600, last_6_hr: 21600, last_1_day: 86400, last_3_days: 259200, last_1_week: 604800, last_1_month: 2592000 };
  const preference = visualization?.timePreference;
  if (!preference || preference === 'global_time') return range;
  if (!durations[preference]) throw new Error('This panel time range is not supported.');
  return { startMs: range.endMs - durations[preference] * 1000, endMs: range.endMs };
}
export function dashboardPanelRequest(panel: DashboardPanel, variables: DashboardValues, globalRange: TimeRange) {
  const range = panelRange(panel, globalRange);
  const { requestType, queries } = panelQueries(panel);
  return { schemaVersion: 'v1', requestType, start: range.startMs, end: range.endMs, variables, compositeQuery: { queries: queries.map((q): QueryEnvelope => ({ ...q, spec: {
    ...q.spec, ...(requestType === 'time_series' && (q.spec.stepInterval == null || q.spec.stepInterval === 0) ? { stepInterval: stepSeconds(range) } : {}),
  } })) } };
}
