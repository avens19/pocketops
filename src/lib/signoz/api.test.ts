import { describe, expect, it } from 'vitest';

import { SignozClient } from './client';
import waterfall from './fixtures/waterfall.json';
import { fetchFieldKeys, fetchFieldValues, fetchRuleQuery, fetchTrace, listRules, normalizeRule, sortRules, toLogRow, toServiceStats } from './api';

const creds = { endpoint: 'https://s.example.com', apiKey: 'k' };

function clientFor(routes: Record<string, unknown>) {
  const seen: string[] = [];
  const impl = (async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]!;
    seen.push(path);
    if (path in routes) return new Response(JSON.stringify({ status: 'success', data: routes[path] }), { status: 200 });
    return new Response(JSON.stringify({ status: 'error', error: { message: 'nope' } }), { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new SignozClient(creds, impl), seen };
}

describe('listRules', () => {
  it('uses the v3 shape when available', async () => {
    const { client } = clientFor({
      '/api/v3/rules': { rules: [{ id: '1', alert: 'High CPU', state: 'firing', labels: { severity: 'critical' } }], total: 1 },
    });
    const rules = await listRules(client);
    expect(rules).toMatchObject([{ id: '1', name: 'High CPU', state: 'firing', severity: 'critical' }]);
  });

  it('falls back to v2 (bare array) and then v1 (nested rules)', async () => {
    const v2 = clientFor({ '/api/v2/rules': [{ id: 'a', alert: 'A', state: 'inactive' }] });
    expect(await listRules(v2.client)).toHaveLength(1);
    expect(v2.seen).toEqual(['/api/v3/rules', '/api/v2/rules']);

    const v1 = clientFor({ '/api/v1/rules': { rules: [{ id: 7, alert: 'Old', state: 'firing' }] } });
    expect(await listRules(v1.client)).toMatchObject([{ id: '7', name: 'Old' }]);
  });

  it('does not swallow auth errors', async () => {
    const impl = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(listRules(new SignozClient(creds, impl))).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('sortRules', () => {
  it('puts firing and critical first', () => {
    const rules = ['inactive', 'firing', 'firing'].map((state, i) =>
      normalizeRule({ id: String(i), alert: `r${i}`, state, labels: i === 2 ? { severity: 'critical' } : {} }),
    );
    expect(sortRules(rules).map((r) => r.id)).toEqual(['2', '1', '0']);
  });

  it('shows disabled rules as disabled whatever their stored state', () => {
    expect(normalizeRule({ id: '1', alert: 'x', state: 'firing', disabled: true }).state).toBe('disabled');
  });
});

describe('toLogRow', () => {
  it('reads resource and attribute maps and upper-cases severity', () => {
    const row = toLogRow({
      timestamp: '2026-01-01T00:00:00Z',
      data: {
        id: 'abc',
        body: 'boom',
        severity_text: 'error',
        trace_id: 't1',
        resources_string: { 'service.name': 'api' },
        attributes_string: { path: '/x' },
        attributes_number: { status: 500 },
      },
    });
    expect(row).toMatchObject({
      id: 'abc',
      severity: 'ERROR',
      service: 'api',
      traceId: 't1',
      attributes: { path: '/x', status: '500' },
    });
  });
});

describe('toServiceStats', () => {
  it('converts nanoseconds to milliseconds and drops unnamed rows', () => {
    const stats = toServiceStats({
      data: {
        results: [
          {
            columns: [
              { name: 'service.name', columnType: 'group' },
              { name: 'a', columnType: 'aggregation', aggregationIndex: 0 },
              { name: 'b', columnType: 'aggregation', aggregationIndex: 1 },
              { name: 'c', columnType: 'aggregation', aggregationIndex: 2 },
            ],
            data: [
              ['api', 100, 5, 250_000_000],
              ['', 1, 0, 1],
            ],
          },
        ],
      },
    });
    expect(stats).toEqual([{ name: 'api', calls: 100, errors: 5, p99Ms: 250 }]);
  });
});

describe('fetchTrace', () => {
  it('uses the waterfall endpoint and keeps attributes and events', async () => {
    const { client, seen } = clientFor({ '/api/v4/traces/t1/waterfall': waterfall.data });
    const trace = await fetchTrace(client, 't1');
    expect(seen).toEqual(['/api/v4/traces/t1/waterfall']);
    expect(trace.totalSpans).toBe(8);
    expect(trace.spans[1].events[0].attributes['exception.type']).toBe('UpstreamTimeoutError');
  });

  it('falls back to a span query, building the tree itself, when the endpoint does not exist', async () => {
    const rows = [
      { timestamp: '2026-10-22T10:00:00.010Z', data: { span_id: 'b', parent_span_id: 'a', name: 'child', 'service.name': 'svc-b', duration_nano: 5_000_000, has_error: true, status_message: 'boom', kind_string: 'Client' } },
      { timestamp: '2026-10-22T10:00:00.000Z', data: { span_id: 'a', parent_span_id: '', name: 'root', 'service.name': 'svc-a', duration_nano: 20_000_000, has_error: false, kind_string: 'Server' } },
    ];
    const { client, seen } = clientFor({ '/api/v5/query_range': { type: 'raw', data: { results: [{ rows }] } } });
    const trace = await fetchTrace(client, 't2');
    expect(seen).toEqual(['/api/v4/traces/t2/waterfall', '/api/v5/query_range']);
    expect(trace.spans.map((x) => [x.name, x.level])).toEqual([['root', 0], ['child', 1]]);
    expect(trace.errorSpans).toBe(1);
    expect(trace.rootService).toBe('svc-a');
  });

  it('does not swallow auth errors by falling back', async () => {
    const impl = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchTrace(new SignozClient(creds, impl), 't3')).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('fetchRuleQuery', () => {
  const def = { condition: { compositeQuery: { queries: [{ type: 'builder_query', spec: { name: 'A', signal: 'logs', filter: { expression: "a = 'b'" } } }] } } };

  it('reads v2 and falls back to v1', async () => {
    const v2 = clientFor({ '/api/v2/rules/r1': def });
    expect(await fetchRuleQuery(v2.client, 'r1')).toMatchObject({ signal: 'logs', expression: "a = 'b'" });
    const v1 = clientFor({ '/api/v1/rules/r1': def });
    expect(await fetchRuleQuery(v1.client, 'r1')).toMatchObject({ signal: 'logs' });
    expect(v1.seen).toEqual(['/api/v2/rules/r1', '/api/v1/rules/r1']);
  });
});

describe('field keys and values', () => {
  const range = { startMs: 1, endMs: 2 };

  it('flattens keys that appear in several contexts into one sorted list', async () => {
    const { client } = clientFor({
      '/api/v1/fields/keys': { keys: { 'service.name': [{ name: 'service.name', fieldContext: 'resource', fieldDataType: 'string' }, { name: 'service.name', fieldContext: 'attribute', fieldDataType: 'string' }], body: [{ name: 'body', fieldContext: 'log', fieldDataType: 'string' }] }, complete: true },
    });
    expect((await fetchFieldKeys(client, 'logs', '', range)).map((k) => k.name)).toEqual(['body', 'service.name']);
  });

  it('merges string, number and bool values and drops empties', async () => {
    const { client } = clientFor({ '/api/v1/fields/values': { values: { stringValues: ['a', ''], numberValues: [502], boolValues: [true] }, complete: true } });
    expect(await fetchFieldValues(client, 'traces', 'x', '', range)).toEqual(['a', '502', 'true']);
  });

  it('tolerates a response with no values', async () => {
    const { client } = clientFor({ '/api/v1/fields/values': {} });
    expect(await fetchFieldValues(client, 'traces', 'x', '', range)).toEqual([]);
  });
});
