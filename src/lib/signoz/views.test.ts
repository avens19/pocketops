import { describe, expect, it, vi } from 'vitest';
import { SignozClient } from './client';
import { getView, listViews, saveView, savedViewQuery, validateViewSpec, viewSpecFromQuery, withViewFilter, type ViewSpec } from './views';
import { logsQuery, metricSeriesQuery, spanGroupsQuery, spanListQuery } from './queries';

const range = { startMs: 1000, endMs: 2000 };
const spec: ViewSpec = {
  displayName: 'Errors', panelType: 'list', requestType: 'raw',
  queries: [{ type: 'builder_query', spec: { name: 'A', signal: 'logs', filter: { expression: "severity_text = 'ERROR'", future: true }, limit: 100 } }],
  selectedFields: [{ name: 'body' }], display: { format: 'table', maxLines: 7 }, futureField: { keep: true },
};
function client(status: number, data?: unknown) {
  const fetcher = vi.fn<typeof fetch>(async () => status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ status: status < 400 ? 'success' : 'error', data }), { status }));
  return { api: new SignozClient({ endpoint: 'https://example.com', apiKey: 'key' }, fetcher as unknown as typeof fetch), fetcher };
}

describe('saved view API contract', () => {
  it('lists by source and handles a null data envelope', async () => {
    const { api, fetcher } = client(200, null);
    expect(await listViews(api, 'metrics')).toEqual([]);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.com/api/v2/saved_views?source=metrics');
  });
  it('loads an encoded ID', async () => {
    const { api, fetcher } = client(200, { id: 'a/b', source: 'logs', schemaVersion: 'v2', spec });
    expect((await getView(api, 'a/b')).spec).toEqual(spec);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.com/api/v2/saved_views/a%2Fb');
  });
  it('creates a generated name and accepts the identifiable response', async () => {
    const { api, fetcher } = client(201, { id: 'new-view' });
    expect(await saveView(api, 'logs', spec)).toBe('new-view');
    const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ source: 'logs', schemaVersion: 'v2', generateName: true, spec });
  });
  it('updates with PUT, keeps the entire spec and accepts 204 without JSON', async () => {
    const { api, fetcher } = client(204);
    expect(await saveView(api, 'logs', spec, 'a/b')).toBe('a/b');
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('a%2Fb');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body as string)).toEqual({ source: 'logs', schemaVersion: 'v2', spec });
  });
  it('explains missing write permissions without retrying or losing the draft', async () => {
    const { api, fetcher } = client(403);
    await expect(saveView(api, 'logs', spec)).rejects.toMatchObject({ kind: 'forbidden', message: expect.stringContaining('create/update') });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps auth, unsupported endpoint and server failures visible', async () => {
    for (const [status, kind] of [[401, 'auth'], [404, 'not-found'], [500, 'server']] as const) {
      await expect(listViews(client(status).api, 'traces')).rejects.toMatchObject({ kind });
    }
  });
});

describe('view query fidelity', () => {
  it('changes one filter without dropping other queries, display settings or unknown fields', () => {
    const original = { ...spec, queries: [...spec.queries, { type: 'formula', spec: { name: 'F1', expression: 'A' } }] };
    const changed = withViewFilter(original, 0, "service.name = 'api'");
    expect(changed).toEqual({ ...original, queries: [{ ...original.queries[0], spec: { ...original.queries[0].spec, filter: { expression: "service.name = 'api'", future: true } } }, original.queries[1]] });
    expect(original.queries[0].spec.filter).toEqual({ expression: "severity_text = 'ERROR'", future: true });
    const execution = savedViewQuery(changed, range).compositeQuery.queries;
    expect(execution[0].spec).toMatchObject(changed.queries[0].spec);
    expect(execution[0].spec.selectFields).toEqual([{ name: 'body' }, { name: 'id' }]);
    expect(execution[1]).toEqual(changed.queries[1]);
    expect(changed.queries[0].spec).not.toHaveProperty('selectFields');
  });
  it('saves complete explorer queries without freezing the time window', () => {
    const cases = [
      ['logs', logsQuery(range, { text: 'failure', levels: ['ERROR'], expression: "service.name = 'api'" }, 50, 0)],
      ['traces', spanListQuery(range, 'isRoot = true AND has_error = true', 50, 0, 'slowest')],
      ['traces', spanGroupsQuery(range, 'has_error = true', ['http.route'])],
      ['metrics', metricSeriesQuery(range, 'requests', 'sum', { aggregation: 'increase', groupBy: { name: 'host.name', context: 'resource' } })],
    ] as const;
    for (const [source, query] of cases) {
      const saved = viewSpecFromQuery(source, query);
      expect(saved.queries).toEqual(query.compositeQuery.queries);
      expect(saved.requestType).toBe(query.requestType);
      expect(saved).not.toHaveProperty('start');
      expect(savedViewQuery(saved, { startMs: 5000, endMs: 6000 })).toMatchObject({ start: 5000, end: 6000 });
    }
  });
  it('rejects blank names, mismatched panel types and malformed advanced edits', () => {
    for (const value of [null, {}, { ...spec, displayName: ' ' }, { ...spec, requestType: 'scalar' }, { ...spec, queries: [] }, { ...spec, queries: [null] }]) {
      expect(() => validateViewSpec(value)).toThrow();
    }
    expect(() => validateViewSpec(spec)).not.toThrow();
  });
});
