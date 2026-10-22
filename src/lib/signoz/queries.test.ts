import { describe, expect, it } from 'vitest';

import { logFilterExpression, parseRawRows, parseScalarRows, parseTimeSeries, quote, stepSeconds } from './queries';

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

  it('prefers a raw expression over text and wraps it', () => {
    expect(logFilterExpression({ text: 'ignored', expression: "a = 1 OR b = 2" })).toBe('(a = 1 OR b = 2)');
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
});
