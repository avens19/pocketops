import { beforeEach, describe, expect, it } from 'vitest';

import { explorer } from './explorer-state';

const eq = (key: string, value: string) => ({ kind: 'filter' as const, key, op: '=' as const, value });

beforeEach(() => {
  explorer.clear('traces');
  explorer.clear('logs');
  explorer.setRootOnly('traces', true);
  explorer.setErrorsOnly('traces', false);
  explorer.setGroupBy('traces', []);
});

describe('explorer store', () => {
  it('stops limiting traces to root spans when investigating a tapped attribute', () => {
    expect(explorer.get('traces').rootOnly).toBe(true);
    explorer.investigate('traces', eq('service.name', 'inventory'));
    expect(explorer.get('traces').rootOnly).toBe(false);
    expect(explorer.get('traces').clauses).toHaveLength(1);
  });

  it('drops the root-only and errors-only limits when a query arrives from a link, alert or service', () => {
    explorer.setErrorsOnly('traces', true);
    explorer.setExpression('traces', "service.name = 'inventory'");
    expect(explorer.get('traces')).toMatchObject({ rootOnly: false, errorsOnly: false });
  });

  it('leaves the toggles alone for an empty expression and when clearing', () => {
    explorer.setExpression('traces', '');
    expect(explorer.get('traces').rootOnly).toBe(true);
    explorer.add('traces', eq('a', '1'));
    explorer.setErrorsOnly('traces', true);
    explorer.clear('traces');
    expect(explorer.get('traces')).toMatchObject({ clauses: [], text: '', rootOnly: true, errorsOnly: true });
  });

  it('keeps logs and traces filters separate', () => {
    explorer.add('logs', eq('a', '1'));
    expect(explorer.get('traces').clauses).toHaveLength(0);
  });

  it('records the route signature it was set from', () => {
    explorer.setExpression('logs', "a = 'x'", '', 'sig-1');
    expect(explorer.get('logs').sig).toBe('sig-1');
    explorer.clear('logs');
    expect(explorer.get('logs').sig).toBe('sig-1');
  });

  it('leaves group-by when drilling into a group or when a query arrives from elsewhere', () => {
    explorer.setGroupBy('traces', ['http.route']);
    explorer.investigate('traces', eq('http.route', '/api/cart'));
    expect(explorer.get('traces').groupBy).toEqual([]);
    explorer.setGroupBy('traces', ['http.route']);
    explorer.setExpression('traces', "service.name = 'x'");
    expect(explorer.get('traces').groupBy).toEqual([]);
  });

  it('keeps group-by across clearing the filter', () => {
    explorer.setGroupBy('traces', ['http.route']);
    explorer.clear('traces');
    expect(explorer.get('traces').groupBy).toEqual(['http.route']);
  });
});
