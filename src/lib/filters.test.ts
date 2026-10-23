import { describe, expect, it } from 'vitest';

import {
  addClause,
  clausesToExpression,
  describeClause,
  inferValue,
  isValidKey,
  parseExpression,
  removeClause,
  type Clause,
} from './filters';

const eq = (key: string, value: string | number | boolean): Clause => ({ kind: 'filter', key, op: '=', value });
const ne = (key: string, value: string | number | boolean): Clause => ({ kind: 'filter', key, op: '!=', value });

describe('parseExpression', () => {
  it('reads simple AND-joined clauses', () => {
    expect(parseExpression("service.name = 'checkout' AND http.response.status_code >= 500")).toEqual([
      eq('service.name', 'checkout'),
      { kind: 'filter', key: 'http.response.status_code', op: '>=', value: 500 },
    ]);
  });

  it('reads booleans, CONTAINS, EXISTS and IN', () => {
    expect(parseExpression("has_error = true AND body CONTAINS 'timeout' AND http.route EXISTS AND severity_text IN ('ERROR', 'WARN')")).toEqual([
      eq('has_error', true),
      { kind: 'filter', key: 'body', op: 'CONTAINS', value: 'timeout' },
      { kind: 'filter', key: 'http.route', op: 'EXISTS' },
      { kind: 'filter', key: 'severity_text', op: 'IN', values: ['ERROR', 'WARN'] },
    ]);
  });

  it('reads IN with square brackets, as SigNoz links write it', () => {
    expect(parseExpression("env IN ['prod', 'stage']")).toEqual([{ kind: 'filter', key: 'env', op: 'IN', values: ['prod', 'stage'] }]);
  });

  it('does not split on AND inside quotes', () => {
    expect(parseExpression("body CONTAINS 'cats AND dogs' AND x = 1")).toEqual([
      { kind: 'filter', key: 'body', op: 'CONTAINS', value: 'cats AND dogs' },
      eq('x', 1),
    ]);
  });

  it('unwraps a parenthesised AND-group into its clauses', () => {
    expect(parseExpression("(a = 1 AND b = 2) AND c = 3")).toEqual([eq('a', 1), eq('b', 2), eq('c', 3)]);
    expect(parseExpression("((service.name = 'x' AND severity_text = 'ERROR')) AND host = 'h'")).toHaveLength(3);
  });

  it('keeps a parenthesised group containing OR whole', () => {
    expect(parseExpression('(a = 1 OR b = 2) AND c = 3')).toEqual([{ kind: 'raw', text: '(a = 1 OR b = 2)' }, eq('c', 3)]);
  });

  it('does not treat (a) AND (b) as one wrapped group', () => {
    expect(parseExpression('(a = 1) AND (b = 2)')).toEqual([eq('a', 1), eq('b', 2)]);
  });

  it('reads clauses separated only by whitespace as AND, the way SigNoz writes them', () => {
    expect(parseExpression("deployment.environment in ['production'] user.name = 'Cargurus'")).toEqual([
      { kind: 'filter', key: 'deployment.environment', op: 'IN', values: ['production'] },
      eq('user.name', 'Cargurus'),
    ]);
    expect(parseExpression("service.name = 'a' http.status_code >= 500 has_error = true http.route EXISTS body CONTAINS 'x'")).toEqual([
      eq('service.name', 'a'),
      { kind: 'filter', key: 'http.status_code', op: '>=', value: 500 },
      eq('has_error', true),
      { kind: 'filter', key: 'http.route', op: 'EXISTS' },
      { kind: 'filter', key: 'body', op: 'CONTAINS', value: 'x' },
    ]);
  });

  it('mixes implicit and explicit AND', () => {
    expect(parseExpression("a = 1 b = 2 AND c IN (3, 4) d != 'x'")).toEqual([
      eq('a', 1),
      eq('b', 2),
      { kind: 'filter', key: 'c', op: 'IN', values: [3, 4] },
      ne('d', 'x'),
    ]);
  });

  it('does not split inside quotes or lists that look like clauses', () => {
    expect(parseExpression("body CONTAINS 'a = 1 b = 2' c = 3")).toEqual([
      { kind: 'filter', key: 'body', op: 'CONTAINS', value: 'a = 1 b = 2' },
      eq('c', 3),
    ]);
    expect(parseExpression("env IN ['x = 1', 'y z = 2'] k = 'v'")).toEqual([
      { kind: 'filter', key: 'env', op: 'IN', values: ['x = 1', 'y z = 2'] },
      eq('k', 'v'),
    ]);
  });

  it('writes an implicit-AND expression back with explicit ANDs', () => {
    expect(clausesToExpression(parseExpression("env in ['production'] user.name = 'Cargurus'"))).toBe(
      "env IN ('production') AND user.name = 'Cargurus'",
    );
  });

  it('leaves whitespace-separated text it cannot read cleanly as one raw clause', () => {
    expect(parseExpression("a = 1 junk")).toEqual([{ kind: 'raw', text: 'a = 1 junk' }]);
    expect(parseExpression("a = 1 NOT b = 2")).toEqual([{ kind: 'raw', text: 'a = 1 NOT b = 2' }]);
    expect(parseExpression("a = 1 b = unquoted")).toEqual([{ kind: 'raw', text: 'a = 1 b = unquoted' }]);
    expect(parseExpression("a = 1 b = 2 OR c = 3")).toEqual([{ kind: 'raw', text: 'a = 1 b = 2 OR c = 3' }]);
  });

  it('keeps anything it cannot read as a raw clause', () => {
    expect(parseExpression("a = 1 OR b = 2")).toEqual([{ kind: 'raw', text: 'a = 1 OR b = 2' }]);
    expect(parseExpression("search('boom')")).toEqual([{ kind: 'raw', text: "search('boom')" }]);
    expect(parseExpression("duration_nano > 1s")).toEqual([{ kind: 'raw', text: 'duration_nano > 1s' }]);
  });

  it('unescapes quotes', () => {
    expect(parseExpression("body = 'it\\'s fine'")).toEqual([eq('body', "it's fine")]);
  });

  it('is empty for blank input', () => {
    expect(parseExpression('')).toEqual([]);
    expect(parseExpression('   ')).toEqual([]);
  });
});

describe('clausesToExpression', () => {
  it('round-trips what the parser reads', () => {
    const expr = "service.name = 'checkout' AND http.route != '/health' AND count > 3 AND severity_text IN ('ERROR', 'WARN') AND x NOT EXISTS";
    expect(clausesToExpression(parseExpression(expr))).toBe(expr);
  });

  it('quotes and escapes string values', () => {
    expect(clausesToExpression([eq('body', "it's")])).toBe("body = 'it\\'s'");
  });

  it('parenthesises a raw OR clause when combined with others', () => {
    const clauses = [...parseExpression('a = 1 OR b = 2'), eq('c', 3)];
    expect(clausesToExpression(clauses)).toBe('(a = 1 OR b = 2) AND c = 3');
  });

  it('leaves a lone raw OR clause alone', () => {
    expect(clausesToExpression(parseExpression('a = 1 OR b = 2'))).toBe('a = 1 OR b = 2');
  });
});

describe('addClause / removeClause', () => {
  it('does not duplicate an identical clause', () => {
    const once = addClause([], eq('service.name', 'api'));
    expect(addClause(once, eq('service.name', 'api'))).toBe(once);
  });

  it('turns an include into an exclude of the same value', () => {
    expect(addClause([eq('service.name', 'api')], ne('service.name', 'api'))).toEqual([ne('service.name', 'api')]);
    expect(addClause([ne('service.name', 'api')], eq('service.name', 'api'))).toEqual([eq('service.name', 'api')]);
  });

  it('keeps a second value for the same key', () => {
    expect(addClause([eq('service.name', 'api')], eq('service.name', 'web'))).toHaveLength(2);
  });

  it('removes by index', () => {
    expect(removeClause([eq('a', 1), eq('b', 2), eq('c', 3)], 1)).toEqual([eq('a', 1), eq('c', 3)]);
  });
});

describe('inferValue / describeClause', () => {
  it('infers numbers and booleans but keeps long digit strings as text', () => {
    expect(inferValue('502')).toBe(502);
    expect(inferValue('1.5')).toBe(1.5);
    expect(inferValue('true')).toBe(true);
    expect(inferValue('0123456789012345678')).toBe('0123456789012345678');
    expect(inferValue('checkout')).toBe('checkout');
  });

  it('describes a clause for a chip', () => {
    expect(describeClause(ne('http.route', '/health'))).toEqual({ key: 'http.route', op: 'is not', value: '/health' });
    expect(describeClause({ kind: 'raw', text: 'a = 1 OR b = 2' }).value).toBe('a = 1 OR b = 2');
  });
});

describe('review regressions', () => {
  it('keeps filters on different fields that share a value', () => {
    const once = addClause([], eq('service.name', 'api'));
    expect(addClause(once, eq('host.name', 'api'))).toHaveLength(2);
    const exists = addClause([], { kind: 'filter', key: 'a', op: 'EXISTS' });
    expect(addClause(exists, { kind: 'filter', key: 'b', op: 'EXISTS' })).toHaveLength(2);
  });

  it('never squashes an OR (or anything after the first literal) into one comparison', () => {
    expect(parseExpression("service.name = 'api' OR service.name = 'web'")).toEqual([
      { kind: 'raw', text: "service.name = 'api' OR service.name = 'web'" },
    ]);
    expect(parseExpression("service.name IN ('a') OR x = 'b'")).toHaveLength(1);
    expect(parseExpression("body = 'a' 'b'")).toEqual([{ kind: 'raw', text: "body = 'a' 'b'" }]);
    expect(parseExpression("env IN ('a', 'b' 'c')")[0].kind).toBe('raw');
  });

  it('respects AND-binds-tighter-than-OR', () => {
    expect(parseExpression('a = 1 OR b = 2 AND c = 3')).toEqual([{ kind: 'raw', text: 'a = 1 OR b = 2 AND c = 3' }]);
    const added = addClause(parseExpression('(a = 1) OR (b = 2)'), eq('tenant', 'prod'));
    expect(clausesToExpression(added)).toBe("((a = 1) OR (b = 2)) AND tenant = 'prod'");
  });

  it('keeps numbers verbatim unless they print back unchanged', () => {
    expect(clausesToExpression(parseExpression('id = 9007199254740993'))).toBe('id = 9007199254740993');
    expect(parseExpression('v = 1.50')[0].kind).toBe('raw');
    expect(parseExpression('v = 007')[0].kind).toBe('raw');
    expect(parseExpression('v = 1.5')[0]).toEqual(eq('v', 1.5));
    expect(inferValue('007')).toBe('007');
    expect(inferValue('1.50')).toBe('1.50');
    expect(inferValue('9007199254740993')).toBe('9007199254740993');
  });

  it('only accepts keys that can be written as a bare field name', () => {
    expect(isValidKey('http.response.status_code')).toBe(true);
    expect(isValidKey('k8s.pod.name')).toBe(true);
    expect(isValidKey("service.name = 'gateway' OR service.name")).toBe(false);
    expect(isValidKey("a b")).toBe(false);
    expect(isValidKey('')).toBe(false);
  });
});
