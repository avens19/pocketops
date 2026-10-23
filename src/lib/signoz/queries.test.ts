import { describe, expect, it } from 'vitest';

import { logFilterExpression, metricAggregations, metricSeriesQuery, parseGroupedRows, parseRawRows, parseScalarRows, rollingRange, parseTimeSeries, quote, spanGroupsQuery, spanListQuery, stepSeconds } from './queries';

describe('quote', () => {
  it('escapes quotes and backslashes', () => {
    expect(quote("it's")).toBe("'it\\'s'");
    expect(quote('a\\b')).toBe("'a\\\\b'");
  });
});

describe('logFilterExpression', () => {
  it('combines text, levels and service', () => {
    const expr = logFilterExpression({ text: 'timeout', levels: ['WARN'], service: 'api' });
    expect(expr).toBe(
      "body CONTAINS 'timeout' AND severity_text IN ('WARN', 'warn', 'Warn', 'WARNING', 'warning', 'Warning') AND service.name = 'api'",
    );
  });

  it('wraps a raw expression and combines it with the search text', () => {
    expect(logFilterExpression({ expression: 'a = 1 OR b = 2' })).toBe('(a = 1 OR b = 2)');
    expect(logFilterExpression({ text: 'boom', expression: 'a = 1 OR b = 2' })).toBe("(a = 1 OR b = 2) AND body CONTAINS 'boom'");
  });

  it('is empty with no filters', () => {
    expect(logFilterExpression({})).toBe('');
  });

  it('cannot be broken out of by a quote in the search text', () => {
    expect(logFilterExpression({ text: "x' OR 1=1 --" })).toBe("body CONTAINS 'x\\' OR 1=1 --'");
  });
});

describe('stepSeconds', () => {
  it('scales with the range', () => {
    expect(stepSeconds({ startMs: 0, endMs: 15 * 60_000 })).toBe(60);
    expect(stepSeconds({ startMs: 0, endMs: 24 * 3600_000 })).toBe(1800);
    expect(stepSeconds({ startMs: 0, endMs: 7 * 24 * 3600_000 })).toBe(14400);
  });
});

describe('parseRawRows', () => {
  it('reads rows from the first result', () => {
    const rows = parseRawRows({ data: { results: [{ rows: [{ timestamp: 't', data: { body: 'hi' } }] }] } });
    expect(rows).toEqual([{ timestamp: 't', data: { body: 'hi' } }]);
  });

  it('tolerates null rows', () => {
    expect(parseRawRows({ data: { results: [{ rows: null }] } })).toEqual([]);
    expect(parseRawRows(undefined)).toEqual([]);
  });
});

describe('parseScalarRows', () => {
  const resp = {
    data: {
      results: [
        {
          columns: [
            { name: 'service.name', columnType: 'group' },
            { name: '__result_0', columnType: 'aggregation', aggregationIndex: 0 },
            { name: '__result_1', columnType: 'aggregation', aggregationIndex: 1 },
          ],
          data: [['api', 10, 2]],
        },
      ],
    },
  };

  it('keys aggregation columns by the requested aliases', () => {
    expect(parseScalarRows(resp, ['calls', 'errors'])).toEqual([{ 'service.name': 'api', calls: 10, errors: 2 }]);
  });

  it('falls back to positional keys', () => {
    expect(parseScalarRows(resp)).toEqual([{ 'service.name': 'api', agg0: 10, agg1: 2 }]);
  });
});

describe('parseTimeSeries', () => {
  it('flattens aggregations and drops partial points', () => {
    const series = parseTimeSeries(
      {
        data: {
          results: [
            {
              aggregations: [
                {
                  series: [
                    {
                      labels: [{ key: { name: 'host.name' }, value: 'h1' }],
                      values: [
                        { timestamp: 1, value: 2 },
                        { timestamp: 2, value: 3, partial: true },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    );
    expect(series).toEqual([{ name: 'h1', labels: { 'host.name': 'h1' }, points: [{ t: 1, v: 2 }] }]);
  });
  it('returns points in time order even when the server does not', () => {
    const series = parseTimeSeries({
      data: { results: [{ aggregations: [{ series: [{ values: [{ timestamp: 30, value: 3 }, { timestamp: 10, value: 1 }, { timestamp: 20, value: 2 }] }] }] }] },
    });
    expect(series[0].points.map((p) => p.t)).toEqual([10, 20, 30]);
  });
  it('names aggregations by their own index, not their position in the response', () => {
    const series = parseTimeSeries(
      {
        data: {
          results: [
            {
              aggregations: [
                { index: 1, alias: '__result_1', series: [{ values: [{ timestamp: 1, value: 2 }] }] },
                { index: 0, alias: '__result_0', series: [{ values: [{ timestamp: 1, value: 42 }] }] },
              ],
            },
          ],
        },
      },
      ['calls', 'errors'],
    );
    expect(series.map((s) => [s.name, s.points[0].v])).toEqual([
      ['errors', 2],
      ['calls', 42],
    ]);
  });
});

describe('spanListQuery', () => {
  const range = { startMs: 0, endMs: 1 };
  const spec = (sort: 'latest' | 'slowest') => (spanListQuery(range, '', 50, 100, sort).compositeQuery.queries[0] as { spec: { order: { key: { name: string } }[]; offset: number } }).spec;

  it('breaks ties on span_id in both orders so offset paging is stable', () => {
    expect(spec('latest').order.map((o) => o.key.name)).toEqual(['timestamp', 'span_id']);
    expect(spec('slowest').order.map((o) => o.key.name)).toEqual(['duration_nano', 'span_id']);
  });

  it('carries the offset', () => {
    expect(spec('latest').offset).toBe(100);
  });
});

describe('spanGroupsQuery', () => {
  it('asks for count, errors and p99 per group, biggest first', () => {
    const spec = (spanGroupsQuery({ startMs: 0, endMs: 1 }, 'isRoot = true', ['http.route']).compositeQuery.queries[0] as {
      spec: { aggregations: { alias: string }[]; groupBy: { name: string }[]; order: { key: { name: string }; direction: string }[] };
    }).spec;
    expect(spec.aggregations.map((a) => a.alias)).toEqual(['count', 'errors', 'p99']);
    expect(spec.groupBy).toEqual([{ name: 'http.route' }]);
    expect(spec.order).toEqual([{ key: { name: 'count' }, direction: 'desc' }]);
  });
});

describe('metric aggregations', () => {
  const agg = (kind: string, options = {}) =>
    (metricSeriesQuery({ startMs: 0, endMs: 1 }, 'm', kind, options).compositeQuery.queries[0] as { spec: { aggregations: Record<string, string>[]; groupBy?: Record<string, string>[] } }).spec;

  it('offers choices that fit the metric type, default first', () => {
    expect(metricAggregations('sum', true).map((a) => a.key)).toEqual(['rate', 'increase']);
    expect(metricAggregations('sum', false).map((a) => a.key)).toEqual(['avg', 'max', 'latest']);
    expect(metricAggregations('gauge').map((a) => a.key)).toEqual(['latest', 'avg', 'max', 'min']);
    expect(metricAggregations('histogram').map((a) => a.key)).toEqual(['p99', 'p95', 'p90', 'p50']);
  });

  it('keeps the previous default behaviour per type', () => {
    expect(agg('gauge').aggregations[0]).toEqual({ metricName: 'm', timeAggregation: 'latest', spaceAggregation: 'avg' });
    expect(agg('sum', { monotonic: true }).aggregations[0]).toEqual({ metricName: 'm', timeAggregation: 'rate', spaceAggregation: 'sum' });
    expect(agg('histogram').aggregations[0]).toEqual({ metricName: 'm', spaceAggregation: 'p99' });
  });

  it('applies a chosen aggregation, ignoring one that does not fit the type', () => {
    expect(agg('gauge', { aggregation: 'max' }).aggregations[0]).toMatchObject({ timeAggregation: 'max', spaceAggregation: 'max' });
    expect(agg('histogram', { aggregation: 'p50' }).aggregations[0]).toEqual({ metricName: 'm', spaceAggregation: 'p50' });
    expect(agg('sum', { monotonic: true, aggregation: 'max' }).aggregations[0]).toMatchObject({ timeAggregation: 'rate' });
  });

  it('groups by a label in the context it lives in', () => {
    expect(agg('gauge', { groupBy: { name: 'http.response.status_class', context: 'attribute' } }).groupBy).toEqual([{ name: 'http.response.status_class', fieldContext: 'attribute' }]);
    expect(agg('gauge', { groupBy: { name: 'service.name', context: '' } }).groupBy).toEqual([{ name: 'service.name', fieldContext: 'resource' }]);
  });
});

describe('rollingRange', () => {
  const now = 1_000_000_000;
  it('ends a preset or duration now', () => {
    expect(rollingRange({ key: '1h' }, now)).toEqual({ startMs: now - 3_600_000, endMs: now });
    expect(rollingRange({ lastMs: 90_000 }, now)).toEqual({ startMs: now - 90_000, endMs: now });
  });
  it('slides a fixed window of the same length up to now, so Live on a pasted link actually tails', () => {
    expect(rollingRange({ startMs: 5_000, endMs: 305_000 }, now)).toEqual({ startMs: now - 300_000, endMs: now });
  });
});

describe('parseGroupedRows', () => {
  it('keeps group columns and aggregation columns in separate namespaces', () => {
    const rows = parseGroupedRows(
      {
        data: {
          results: [
            {
              columns: [
                { name: 'errors', columnType: 'group' },
                { name: '__result_1', columnType: 'aggregation', aggregationIndex: 1 },
                { name: '__result_0', columnType: 'aggregation', aggregationIndex: 0 },
              ],
              data: [['payment', 3, 9]],
            },
          ],
        },
      },
      ['count', 'errors'],
    );
    expect(rows).toEqual([{ groups: { errors: 'payment' }, stats: { errors: 3, count: 9 } }]);
  });
  it('is empty for no result', () => {
    expect(parseGroupedRows(undefined)).toEqual([]);
  });
});
