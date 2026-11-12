import { SignozClient, SignozError } from './client';
import type { TimeRange } from './queries';

export type ViewSource = 'logs' | 'metrics' | 'traces';
export type QueryEnvelope = { type: string; spec: Record<string, unknown>; [key: string]: unknown };
export interface ViewSpec {
  displayName: string;
  panelType: 'list' | 'graph' | 'table' | 'value' | 'trace';
  requestType: 'raw' | 'time_series' | 'scalar' | 'trace';
  queries: QueryEnvelope[];
  selectedFields?: Record<string, unknown>[];
  [key: string]: unknown;
}
export interface SavedView {
  id: string;
  name?: string;
  source: ViewSource;
  schemaVersion: 'v2';
  spec: ViewSpec;
  updatedAt?: string;
}
const PATH = '/api/v2/saved_views';

export function isViewSource(value: unknown): value is ViewSource {
  return value === 'logs' || value === 'metrics' || value === 'traces';
}

export async function listViews(client: SignozClient, source: ViewSource, signal?: AbortSignal): Promise<SavedView[]> {
  const data = await client.request<SavedView[] | null>(PATH, { query: { source }, signal });
  return (data ?? []).filter((view) => view.source === source).sort((a, b) => a.spec.displayName.localeCompare(b.spec.displayName));
}
export function getView(client: SignozClient, id: string, signal?: AbortSignal) {
  return client.request<SavedView>(`${PATH}/${encodeURIComponent(id)}`, { signal });
}

/** Full replacement: retain unknown spec/query/display fields when editing views from the web UI. */
export async function saveView(client: SignozClient, source: ViewSource, spec: ViewSpec, id?: string): Promise<string> {
  validateViewSpec(spec);
  const body = { source, schemaVersion: 'v2', spec };
  try {
    if (id) {
      await client.request(`${PATH}/${encodeURIComponent(id)}`, { method: 'PUT', body });
      return id;
    }
    const result = await client.request<{ id: string }>(PATH, { method: 'POST', body: { ...body, generateName: true } });
    if (!result?.id) throw new Error('SigNoz did not return the saved view ID. Check Saved views before retrying.');
    return result.id;
  } catch (error) {
    if (error instanceof SignozError && error.kind === 'forbidden') {
      throw new SignozError('This API key can’t save views. Use a service-account key with saved-view create/update permissions in Settings.', 'forbidden', 403);
    }
    throw error;
  }
}

export function validateViewSpec(value: unknown): asserts value is ViewSpec {
  const spec = value as ViewSpec | null;
  if (!spec || typeof spec !== 'object' || typeof spec.displayName !== 'string' || !spec.displayName.trim()) throw new Error('Enter a view name.');
  if (spec.selectedFields !== undefined && (!Array.isArray(spec.selectedFields) || spec.selectedFields.some((f) => !f || typeof f.name !== 'string'))) throw new Error('Selected fields must be a list of named fields.');
  const pairs: Record<string, string> = { list: 'raw', graph: 'time_series', table: 'scalar', value: 'scalar', trace: 'trace' };
  if (!Object.hasOwn(pairs, spec.panelType) || pairs[spec.panelType] !== spec.requestType) throw new Error('Panel type and request type do not match.');
  if (!Array.isArray(spec.queries) || !spec.queries.length || spec.queries.some((q) => !q || typeof q.type !== 'string' || !q.spec || typeof q.spec !== 'object' || Array.isArray(q.spec))) throw new Error('Provide at least one query with a type and spec.');
}

/** Time windows belong to the explorer session, not the saved-view API. */
export function viewSpecFromQuery(source: ViewSource, body: { requestType: string; compositeQuery: { queries: unknown[] } }): ViewSpec {
  const requestType = body.requestType as ViewSpec['requestType'];
  return {
    displayName: '',
    panelType: requestType === 'raw' ? 'list' : requestType === 'scalar' ? 'table' : 'graph',
    requestType,
    queries: body.compositeQuery.queries as QueryEnvelope[],
    selectedFields: requestType !== 'raw' ? [] : (source === 'logs'
      ? ['timestamp', 'body', 'severity_text', 'service.name']
      : ['timestamp', 'name', 'service.name', 'duration_nano', 'trace_id', 'span_id'])
      .map((name) => ({ name, signal: source })),
  };
}

export function savedViewQuery(spec: ViewSpec, range: TimeRange) {
  return {
    schemaVersion: 'v1', start: Math.floor(range.startMs), end: Math.floor(range.endMs),
    requestType: spec.requestType,
    compositeQuery: { queries: spec.queries.map((query) => {
      if (spec.requestType !== 'raw' || query.type !== 'builder_query' || !spec.selectedFields?.length) return query;
      // The web explorer stores columns on the view; query_range expects them on each builder query.
      const fields = [...(Array.isArray(query.spec.selectFields) ? query.spec.selectFields : []), ...spec.selectedFields];
      const required = query.spec.signal === 'logs' ? ['id', 'body'] : ['trace_id', 'span_id', 'name'];
      for (const name of required) if (!fields.some((field) => field.name === name)) fields.push({ name });
      return { ...query, spec: { ...query.spec, selectFields: fields.filter((field, index) => fields.findIndex((f) => f.name === field.name && f.fieldContext === field.fieldContext) === index) } };
    }) },
  };
}

export function withViewFilter(spec: ViewSpec, index: number, expression: string): ViewSpec {
  return { ...spec, queries: spec.queries.map((query, i) => i !== index ? query : {
    ...query, spec: { ...query.spec, filter: { ...(query.spec.filter as object | undefined), expression } },
  }) };
}
