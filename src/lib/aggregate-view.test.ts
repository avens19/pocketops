import { beforeEach, describe, expect, it } from 'vitest';
import { aggregateDrillClauses, aggregateQuery, aggregateRows, aggregateSeries, configureAggregate } from './aggregate-view';
import { explorer } from './explorer-state';
import { asExplorerView, mergeExplorerView } from './explorer-view';
import { clausesToExpression } from './filters';
import apollo from './signoz/fixtures/saved-view-apollo-cache.json';
import response from './signoz/fixtures/apollo-cache-timeseries.json';
import slow from './signoz/fixtures/saved-view-slow-ssr.json';
import page from './signoz/fixtures/saved-view-page-load-perf.json';
import type { SavedView, ViewSpec } from './signoz/views';

const range = { startMs: 1000, endMs: 3601000 };
const saved = (spec: unknown): SavedView => ({ id: 'view', source: 'traces', schemaVersion: 'v2', spec: spec as ViewSpec });
beforeEach(() => explorer.reset());

describe('custom saved aggregates', () => {
  it.each([slow, page])('opens $displayName in the explorer and preserves its entire query on a no-op save', (fixture) => {
    const view = saved(fixture);
    const loaded = asExplorerView(view)!;
    expect(loaded?.aggregate).toBeDefined();
    explorer.loadView(view, loaded, 'sig');
    expect(explorer.get('traces').aggregate?.queries[0].spec.aggregations).toEqual(fixture.queries[0].spec.aggregations);
    expect(mergeExplorerView(view, loaded.baseline, loaded.aggregate!)).toBe(view.spec);
    const request = aggregateQuery(loaded.aggregate!, range);
    expect(request.requestType).toBe(fixture.requestType);
    expect(request.compositeQuery.queries[0].spec).toMatchObject({
      aggregations: fixture.queries[0].spec.aggregations, groupBy: fixture.queries[0].spec.groupBy,
      order: fixture.queries[0].spec.order, limit: 10,
    });
    expect(request.compositeQuery.queries[0].spec.filter).toMatchObject({ expression: expect.stringContaining('production') });
  });
  it('replaces auto chart steps for execution only, and honors explicit steps', () => {
    const spec = page as ViewSpec;
    expect(aggregateQuery(spec, range).compositeQuery.queries[0].spec.stepInterval).toBe(60);
    expect(spec.queries[0].spec.stepInterval).toBe(0);
    const explicit = { ...spec, queries: [{ ...spec.queries[0], spec: { ...spec.queries[0].spec, stepInterval: 300 } }] };
    expect(asExplorerView(saved(explicit))).not.toBeNull();
    expect(aggregateQuery(explicit, range).compositeQuery.queries[0].spec.stepInterval).toBe(300);
  });
  it('reads custom table values by aggregation index rather than assuming count/errors/p99', () => {
    const response = { data: { results: [{ columns: [
      { name: '__result_0', columnType: 'aggregation', aggregationIndex: 0 },
      { name: 'next.route', columnType: 'group' },
    ], data: [[125.5, '/dashboard'], [0, null]] }] } };
    expect(aggregateRows(response, slow as ViewSpec)).toEqual([
      { groups: { 'next.route': '/dashboard' }, values: [{ name: 'p90_ms', value: 125.5 }] },
      { groups: { 'next.route': null }, values: [{ name: 'p90_ms', value: 0 }] },
    ]);
  });
  it('keeps typed chart group values for drilldown and excludes partial/nonfinite points', () => {
    const spec = { ...page, queries: [{ ...page.queries[0], spec: { ...page.queries[0].spec, legend: 'route = {{http.route}}' } }] } as ViewSpec;
    const response = { data: { results: [{ aggregations: [{ index: 0, series: [{ labels: [{ key: { name: 'http.route' }, value: '/home' }], values: [
      { timestamp: 2000, value: 25 }, { timestamp: 1000, value: 10 }, { timestamp: 3000, value: 30, partial: true }, { timestamp: 4000, value: NaN },
    ] }] }] }] } };
    const [result] = aggregateSeries(response, spec);
    expect(result.series.name).toBe('route = /home · p90_ms');
    expect(result.series.points).toEqual([{ t: 1000, v: 10 }, { t: 2000, v: 25 }]);
    expect(aggregateDrillClauses(spec, result.groups)).toEqual([{ kind: 'filter', key: 'http.route', op: '=', value: '/home' }]);
  });
  it('never silently broadens drilldown when group labels are missing or malformed', () => {
    const spec = slow as ViewSpec;
    expect(aggregateDrillClauses(spec, {})).toBeNull();
    expect(aggregateDrillClauses(spec, { 'next.route': {} })).toBeNull();
    expect(aggregateDrillClauses(spec, { 'next.route': null })).toEqual([{ kind: 'filter', key: 'next.route', op: 'NOT EXISTS' }]);
    expect(aggregateDrillClauses(spec, { 'next.route': '001' })).toEqual([{ kind: 'filter', key: 'next.route', op: '=', value: '001' }]);
    expect(aggregateDrillClauses(spec, { 'next.route': 0 })).toEqual([{ kind: 'filter', key: 'next.route', op: '=', value: 0 }]);
  });
  it('preserves original filters during drilldown and restores the chart after detail navigation', () => {
    const view = saved(page);
    const loaded = asExplorerView(view)!;
    explorer.loadView(view, loaded, 'saved-route');
    const before = explorer.get('traces');
    explorer.drillAggregate('traces', aggregateDrillClauses(view.spec, { 'http.route': '/home' })!);
    const drilled = explorer.get('traces');
    expect(drilled.aggregate).toBeUndefined();
    expect(drilled.groupBy).toEqual([]);
    expect(drilled.clauses.slice(0, before.clauses.length)).toEqual(before.clauses);
    expect(clausesToExpression(drilled.clauses)).toContain("http.route = '/home'");
    expect(clausesToExpression(drilled.clauses)).toContain("NOT LIKE '/api/operations/streams/%'");
    expect(drilled.saved).toBe(before.saved);
    explorer.investigate('traces', { kind: 'filter', key: 'service.name', op: '=', value: 'administrative-portal' });
    expect(explorer.get('traces').aggregateReturn).toBeDefined();
    explorer.restoreAggregate('traces');
    expect(explorer.get('traces')).toMatchObject({ aggregate: before.aggregate, clauses: before.clauses, saved: before.saved, sig: 'saved-route' });
  });
  it('keeps root constraints during aggregate drilldown instead of turning them off', () => {
    explorer.setRootOnly('traces', true);
    explorer.setErrorsOnly('traces', true);
    explorer.drillAggregate('traces', []);
    expect(explorer.get('traces')).toMatchObject({ rootOnly: true, errorsOnly: true });
  });
  it('updates aggregation, grouping, sort and limits without dropping display settings or field context', () => {
    const view = saved(slow);
    const loaded = asExplorerView(view)!;
    const edited = configureAggregate(loaded.aggregate!, { aggregations: [{ expression: 'p95(duration_nano) / 1000000', alias: 'p95_ms' }], groupBy: ['next.route'], limit: 25, sort: 'p95_ms', direction: 'desc' });
    const merged = mergeExplorerView(view, loaded.baseline, edited);
    expect(merged.queries[0].spec).toMatchObject({ aggregations: [{ expression: 'p95(duration_nano) / 1000000', alias: 'p95_ms' }], groupBy: slow.queries[0].spec.groupBy, limit: 25, order: [{ key: { name: 'p95_ms' }, direction: 'desc' }] });
    expect(merged.display).toEqual(slow.display);
    expect(merged.selectedFields).toEqual(slow.selectedFields);
  });
  it('rejects stale sort fields, invalid grouping keys, missing aggregations and excessive limits', () => {
    const options = { aggregations: [{ expression: 'count()', alias: 'count' }], groupBy: ['next.route'], limit: 10, sort: 'count', direction: 'desc' as const };
    for (const extra of [{ aggregations: [] }, { groupBy: ['next.route; DROP'] }, { limit: 0 }, { limit: 1001 }, { sort: 'old_alias' }]) {
      expect(() => configureAggregate(slow as ViewSpec, { ...options, ...extra })).toThrow();
    }
  });
});


it('renders the live Apollo response without labels and keeps the bytes percentile', () => {
  const spec = apollo as ViewSpec;
  const loaded = asExplorerView(saved(spec))!;
  expect(loaded.aggregate?.panelType).toBe('graph');
  const parsed = aggregateSeries(response, spec);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].groups).toEqual({});
  expect(parsed[0].series.name).toBe('p90(creditapp.apollo_cache.bytes)');
  expect(parsed[0].series.points.length).toBeGreaterThan(100);
  expect(parsed[0].series.points.every((p, i, all) => !i || p.t > all[i - 1].t)).toBe(true);
});
