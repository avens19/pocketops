import { describe, expect, it } from 'vitest';

import { SignozClient } from './client';
import { listRules, normalizeRule, sortRules, toLogRow, toServiceStats } from './api';

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
