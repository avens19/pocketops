import { describe, expect, it, vi } from 'vitest';
import { router } from 'expo-router';
import dashboard from './signoz/fixtures/dashboard-performance.json';
import { formatMetricQuery, isMetricExplorerView, metricGrouping, metricQueryUnit, metricViewRequest, metricViewResults, updateMetricQuery, validateMetricSpec } from './metric-view';
import { openSavedExplorer } from './open-saved-view';
import type { MetricInfo } from './signoz/types';
import type { QueryEnvelope, SavedView, ViewSpec } from './signoz/views';
vi.mock('expo-router', () => ({ router: { dismissTo: vi.fn() } }));
const queries = dashboard.spec.panels['cpu-percent-of-limit'].spec.queries[0].spec.plugin.spec.queries as QueryEnvelope[];
const spec: ViewSpec = { displayName: 'CPU percent', panelType: 'graph', requestType: 'time_series', queries, display: { color: '#123456', format: '' }, selectedFields: [], futureSetting: { keep: true } };
const saved: SavedView = { id: 'cpu', schemaVersion: 'v2', source: 'metrics', spec };
const range = { startMs: 1000, endMs: 3601000 };
const info = (name: string, unit: string): MetricInfo => ({ name, unit, type: 'gauge', description: '', temporality: '', isMonotonic: false });

describe('native metrics saved views', () => {
  it('routes supported views to Metrics with identity and range rather than the full-query fallback', () => {
    vi.mocked(router.dismissTo).mockClear();
    expect(openSavedExplorer(saved, { last: '604800000' })).toBe(true);
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: '/metrics', params: { saved: 'cpu', prefix: undefined, from: undefined, to: undefined, last: '604800000', n: expect.any(String) } });
    for (const extra of [{ source: 'logs' }, { schemaVersion: 'v1' }, { spec: { ...spec, queries: [{ type: 'promql', spec: { query: 'up' } }] } }, { spec: { ...spec, queries: [{ type: 'builder_query', spec: { signal: 'traces', aggregations: [{ expression: 'count()' }] } }] } }]) {
      expect(isMetricExplorerView({ ...saved, ...extra } as SavedView)).toBe(false);
    }
  });
  it('preserves every formula and hidden input while adding steps only to builder queries', () => {
    const before = JSON.stringify(spec);
    const request = metricViewRequest(spec, range);
    expect(request.compositeQuery.queries.map((q) => q.spec.disabled)).toEqual([true, true, false]);
    expect(request.compositeQuery.queries[0].spec.stepInterval).toBe(60);
    expect(request.compositeQuery.queries[0].spec.limit).toBeUndefined();
    expect(request.compositeQuery.queries[2]).toEqual(queries[2]);
    expect(request.compositeQuery.queries[2].spec).not.toHaveProperty('stepInterval');
    expect(JSON.stringify(spec)).toBe(before);
  });
  it('keeps explicit steps and serializes scalar table and value modes without adding steps', () => {
    const explicit = updateMetricQuery(spec, 0, { stepInterval: 300 });
    expect(metricViewRequest(explicit, range).compositeQuery.queries[0].spec.stepInterval).toBe(300);
    for (const panelType of ['table', 'value'] as const) {
      const next = { ...spec, panelType, requestType: 'scalar' as const };
      expect(isMetricExplorerView({ ...saved, spec: next })).toBe(true);
      expect(metricViewRequest(next, range)).toMatchObject({ requestType: 'scalar', compositeQuery: { queries } });
    }
  });
  it('updates one query without losing siblings, metadata, functions, sorting or display fields', () => {
    const original = updateMetricQuery(spec, 0, { functions: [{ name: 'absolute' }], order: [{ key: { name: 'k8s.container.name', fieldContext: 'resource' }, direction: 'asc' }] });
    expect(updateMetricQuery(original, 0, {})).toEqual(original);
    const edited = updateMetricQuery(original, 1, { filter: { expression: "k8s.namespace.name = 'staging'" } });
    expect(edited.queries[0]).toBe(original.queries[0]);
    expect(edited.queries[2]).toBe(original.queries[2]);
    expect(edited.display).toBe(original.display);
    expect(edited.futureSetting).toEqual({ keep: true });
    expect(edited.selectedFields).toBe(original.selectedFields);
    const q = { type: 'builder_query', spec: { groupBy: [{ name: 'service.name', fieldContext: 'resource', fieldDataType: 'string' }] } };
    expect(metricGrouping(q, ['service.name', 'host.name'])).toEqual([{ name: 'service.name', fieldContext: 'resource', fieldDataType: 'string' }, { name: 'host.name' }]);
    expect(() => metricGrouping(q, ['invalid key'])).toThrow();
  });
  it('renders formula-only results and every named multi-query output', () => {
    const result = (queryName: string, value: number) => ({ queryName, aggregations: [{ index: 0, series: [{ labels: [{ key: { name: 'k8s.container.name' }, value: 'api' }], values: [{ timestamp: 1000, value }] }] }] });
    const parsed = metricViewResults(spec, { data: { results: [result('F1', 25), result('A', 0.5)] } });
    expect(parsed.series).toHaveLength(1);
    expect(parsed.series[0].query.spec.name).toBe('F1');
    expect(parsed.series[0].series.points).toEqual([{ t: 1000, v: 25 }]);
    const visible = updateMetricQuery(spec, 0, { disabled: false });
    expect(metricViewResults(visible, { data: { results: [result('F1', 25), result('A', 0.5)] } }).series).toHaveLength(2);
    const scalar = metricViewResults({ ...spec, panelType: 'table', requestType: 'scalar' }, { data: { results: [{ queryName: 'F1', columns: [{ name: 'F1', columnType: 'aggregation', aggregationIndex: 0 }], data: [[25]] }] } });
    expect(scalar.rows[0].values[0].value).toBe(25);
  });
  it('infers units and rates only when unambiguous; never guesses formula units', () => {
    const q = { type: 'builder_query', spec: { aggregations: [{ metricName: 'cache.bytes', timeAggregation: 'rate' }] } };
    expect(metricQueryUnit(q, [info('cache.bytes', 'By')])).toEqual({ unit: 'By', rate: true });
    expect(formatMetricQuery(1024, q, [info('cache.bytes', 'By')])).toBe('1.00 KB/s');
    expect(metricQueryUnit(queries[2], [info('container.cpu.usage', '%')])).toBeUndefined();
    expect(formatMetricQuery(25, queries[2], [], '%')).toBe('25.00%');
    expect(metricQueryUnit(q, [])).toBeUndefined();
    const mixed = { ...q, spec: { aggregations: [...q.spec.aggregations, { metricName: 'duration', timeAggregation: 'avg' }] } };
    expect(metricQueryUnit(mixed, [info('cache.bytes', 'By'), info('duration', 'ms')])).toBeUndefined();
    const histogram = { ...q, spec: { aggregations: [{ metricName: 'duration.bucket' }] } };
    expect(metricQueryUnit(histogram, [info('duration', 'ms')])?.unit).toBe('ms');
  });
  it('rejects incomplete, all-hidden or ambiguous edits before applying', () => {
    expect(() => validateMetricSpec(spec)).not.toThrow();
    expect(() => validateMetricSpec({ ...spec, queries: queries.map((q) => ({ ...q, spec: { ...q.spec, disabled: true } })) })).toThrow('output');
    expect(() => validateMetricSpec(updateMetricQuery(spec, 0, { limit: -1 }))).toThrow('limits');
    expect(() => validateMetricSpec(updateMetricQuery(spec, 0, { name: 'B' }))).toThrow('unique');
    expect(() => validateMetricSpec(updateMetricQuery(spec, 2, { expression: '' }))).toThrow('formula');
  });
});
