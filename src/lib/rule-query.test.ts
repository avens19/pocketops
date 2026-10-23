import { describe, expect, it } from 'vitest';

import { instanceExpression, parseRuleQuery } from './rule-query';
import { quote } from './signoz/queries';

const v5 = (spec: object, extra: object = {}) => ({ condition: { compositeQuery: { queries: [{ type: 'builder_query', spec }] }, ...extra } });

describe('parseRuleQuery', () => {
  it('reads a current logs rule', () => {
    const q = parseRuleQuery(v5({ name: 'A', signal: 'logs', filter: { expression: "service.name = 'checkout' AND severity_text = 'ERROR'" }, groupBy: [{ name: 'service.name' }, { name: 'namespace' }] }));
    expect(q).toEqual({ signal: 'logs', expression: "service.name = 'checkout' AND severity_text = 'ERROR'", groupBy: ['service.name', 'namespace'] });
  });

  it('prefers the selected query and skips PromQL rules', () => {
    const def = {
      condition: {
        selectedQueryName: 'B',
        compositeQuery: {
          queries: [
            { type: 'builder_query', spec: { name: 'A', signal: 'logs', filter: { expression: 'a = 1' } } },
            { type: 'builder_query', spec: { name: 'B', signal: 'traces', filter: { expression: 'b = 2' } } },
          ],
        },
      },
    };
    expect(parseRuleQuery(def)?.signal).toBe('traces');
    expect(parseRuleQuery({ condition: { compositeQuery: { queries: [{ type: 'promql', spec: { query: 'up' } }] } } })).toBeNull();
  });

  it('reads the older builderQueries shape with filter items', () => {
    const q = parseRuleQuery({
      condition: { compositeQuery: { builderQueries: { A: { dataSource: 'logs', filters: { op: 'AND', items: [{ key: { key: 'service.name' }, op: '=', value: 'api' }] }, groupBy: [{ key: 'service.name' }] } } } },
    });
    expect(q).toEqual({ signal: 'logs', expression: "service.name = 'api'", groupBy: ['service.name'] });
  });

  it('treats the metric signal name from either generation as metrics', () => {
    expect(parseRuleQuery(v5({ name: 'A', signal: 'metrics' }))?.signal).toBe('metrics');
  });

  it('is null without a composite query', () => {
    expect(parseRuleQuery({})).toBeNull();
    expect(parseRuleQuery(undefined)).toBeNull();
  });
});

describe('instanceExpression', () => {
  const base = { signal: 'logs' as const, expression: "severity_text = 'ERROR'", groupBy: ['service.name', 'k8s.pod.name'] };

  it('adds the instance labels for the grouped fields', () => {
    expect(instanceExpression(base, { 'service.name': 'checkout', severity: 'critical' }, quote)).toBe("(severity_text = 'ERROR') AND service.name = 'checkout'");
  });

  it('does not repeat a field the filter already pins', () => {
    const pinned = { ...base, expression: "service.name = 'checkout'" };
    expect(instanceExpression(pinned, { 'service.name': 'checkout' }, quote)).toBe("(service.name = 'checkout')");
  });

  it('adds the constraint when the filter only mentions the field inside an OR', () => {
    const q = { ...base, expression: "service.name = 'api' OR service.name = 'web'", groupBy: ['service.name'] };
    expect(instanceExpression(q, { 'service.name': 'web' }, quote)).toBe("(service.name = 'api' OR service.name = 'web') AND service.name = 'web'");
  });

  it('does not treat a longer value as already pinned', () => {
    const q = { ...base, expression: "service.name = 'checkout-v2'", groupBy: ['service.name'] };
    expect(instanceExpression(q, { 'service.name': 'checkout' }, quote)).toContain("service.name = 'checkout'");
  });

  it('is just the rule filter when the instance has none of the labels', () => {
    expect(instanceExpression(base, {}, quote)).toBe("(severity_text = 'ERROR')");
  });
});
