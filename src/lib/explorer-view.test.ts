import { beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from 'expo-router';
import { explorer } from './explorer-state';
import { asExplorerView, mergeExplorerView } from './explorer-view';
import { applyRouteFilter, paramsLanded, exploreSignature, type ExploreParams } from './explore-links';
import { clausesToExpression } from './filters';
import { openSavedExplorer } from './open-saved-view';
import { logsQuery, spanGroupsQuery, spanListQuery } from './signoz/queries';
import apollo from './signoz/fixtures/saved-view-apollo-cache.json';
import migrations from './signoz/fixtures/saved-view-migrations.json';
import cbbLookups from './signoz/fixtures/saved-view-cbb-lookups.json';
import { savedViewQuery, viewSpecFromQuery, type ViewSpec, type SavedView } from './signoz/views';

vi.mock('expo-router', () => ({ router: { dismissTo: vi.fn() } }));

const range = { startMs: 0, endMs: 1000 };
function saved(source: 'logs' | 'traces', query = source === 'logs' ? logsQuery(range, {}, 50, 0) : spanListQuery(range, '', 50)): SavedView {
  return { id: 'saved-1', source, schemaVersion: 'v2', spec: { ...viewSpecFromQuery(source, query), displayName: 'Saved search', display: { format: 'table' } } };
}
beforeEach(() => { explorer.reset(); vi.clearAllMocks(); });

describe('saved view explorer navigation', () => {
  it('loads log search and filters into the real logs route, retaining the saved identity and range', () => {
    const view = saved('logs', logsQuery(range, { expression: "service.name = 'api'", text: 'failed', levels: ['ERROR'] }, 50, 0));
    expect(openSavedExplorer(view, { last: '21600000' })).toBe(true);
    expect(router.dismissTo).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/logs', params: expect.objectContaining({ saved: view.id, last: '21600000', n: expect.any(String) }) }));
    expect(explorer.get('logs')).toMatchObject({ text: 'failed', saved: { view } });
    expect(explorer.expression('logs')).toContain("service.name = 'api'");
    expect(explorer.expression('logs')).toContain('severity_text IN');
  });
  it('restores root/errors toggles and slowest sorting on the traces tab', () => {
    const view = saved('traces', spanListQuery(range, "isRoot = true AND has_error = true AND service.name = 'api' AND name CONTAINS 'GET'", 50, 0, 'slowest'));
    expect(openSavedExplorer(view)).toBe(true);
    expect(explorer.get('traces')).toMatchObject({ rootOnly: true, errorsOnly: true, text: 'GET', sort: 'slowest', saved: { view } });
    expect(explorer.expression('traces')).toBe("service.name = 'api'");
    expect(router.dismissTo).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/traces' }));
  });
  it('keeps detail-screen refinements when the saved route is revisited', () => {
    const view = saved('traces');
    openSavedExplorer(view);
    const href = vi.mocked(router.dismissTo).mock.calls[0][0] as unknown as { params: { saved: string; n: string; q: string } };
    expect(paramsLanded('traces', href.params)).toBe(true);
    explorer.investigate('traces', { kind: 'filter', key: 'service.name', op: '=', value: 'payments' });
    applyRouteFilter('traces', href.params);
    expect(explorer.expression('traces')).toBe("service.name = 'payments'");
    expect(explorer.get('traces').saved?.view.id).toBe(view.id);
  });
  it('fully replaces prior filters and resets root-only even for an unfiltered saved view', () => {
    explorer.setExpression('traces', "service.name = 'old'");
    explorer.setRootOnly('traces', true);
    explorer.setErrorsOnly('traces', true);
    explorer.setGroupBy('traces', ['http.route']);
    explorer.setSort('traces', 'slowest');
    openSavedExplorer(saved('traces'));
    expect(explorer.get('traces')).toMatchObject({ clauses: [], text: '', rootOnly: false, errorsOnly: false, groupBy: [], sort: 'latest' });
  });
  it('does not reattach a view after leaving it, but explicitly reopening reloads it', () => {
    const view = saved('logs');
    openSavedExplorer(view);
    const first = vi.mocked(router.dismissTo).mock.calls[0][0] as unknown as { params: { saved: string; n: string } };
    explorer.detachView('logs');
    applyRouteFilter('logs', first.params);
    expect(explorer.get('logs').saved).toBeUndefined();
    openSavedExplorer(view);
    expect(explorer.get('logs').saved?.view.id).toBe(view.id);
    expect(explorer.get('logs').sig).not.toContain(first.params.n);
  });
  it('clears the view identity for unrelated route filters and when switching accounts', () => {
    openSavedExplorer(saved('logs'));
    const destination = vi.mocked(router.dismissTo).mock.calls[0][0] as unknown as { params: ExploreParams };
    applyRouteFilter('logs', destination.params);
    applyRouteFilter('logs', { service: 'other', n: 'other-link' });
    expect(explorer.get('logs').saved).toBeUndefined();
    openSavedExplorer(saved('logs'));
    explorer.reset();
    expect(explorer.get('logs').saved).toBeUndefined();
    expect(explorer.get('logs').clauses).toEqual([]);
  });
});

describe('saved query fidelity in the explorer', () => {
  it('round-trips a web list view without changing columns, query name, display, limit or original expression formatting', () => {
    const view = saved('logs', logsQuery(range, { expression: "(service.name = 'api')", text: 'failure' }, 100, 0));
    view.spec.queries[0].spec.name = 'B';
    view.spec.queries[0].spec.stepInterval = null;
    view.spec.queries[0].spec.legend = 'Custom';
    const loaded = asExplorerView(view)!;
    expect(loaded).not.toBeNull();
    const current = viewSpecFromQuery('logs', logsQuery(range, { expression: loaded.expression, text: loaded.text }, 50, 0));
    expect(mergeExplorerView(view, loaded.baseline, current)).toBe(view.spec);
    const edited = viewSpecFromQuery('logs', logsQuery(range, { expression: loaded.expression, text: 'timeout' }, 50, 0));
    const result = mergeExplorerView(view, loaded.baseline, edited);
    expect(result).toMatchObject({ display: view.spec.display, selectedFields: view.spec.selectedFields, queries: [{ spec: { name: 'B', limit: 100, stepInterval: null, legend: 'Custom', filter: { expression: expect.stringContaining("body CONTAINS 'timeout'") } } }] });
    expect(view.spec.queries[0].spec.filter).not.toEqual(result.queries[0].spec.filter);
  });
  it('supports PocketOps trace groups and preserves the view through group drilldown', () => {
    const view = saved('traces', spanGroupsQuery(range, 'has_error = true', ['http.route']));
    openSavedExplorer(view);
    const state = explorer.get('traces');
    expect(state.groupBy).toEqual(['http.route']);
    expect(state.errorsOnly).toBe(true);
    explorer.investigate('traces', { kind: 'filter', key: 'http.route', op: '=', value: '/checkout' });
    const expression = `has_error = true AND (${clausesToExpression(explorer.get('traces').clauses)})`;
    const current = viewSpecFromQuery('traces', spanListQuery(range, expression, 50));
    const result = mergeExplorerView(view, state.saved!.baseline, current);
    expect(result).toMatchObject({ panelType: 'list', requestType: 'raw' });
    expect(result.queries[0].spec).not.toHaveProperty('aggregations');
    expect(result.queries[0].spec).not.toHaveProperty('groupBy');
    expect(result.queries[0].spec.filter).toEqual({ expression });
  });
  it('does not split OR expressions into toggles that change the query meaning', () => {
    const view = saved('traces', spanListQuery(range, "isRoot = true OR has_error = true", 50));
    const loaded = asExplorerView(view)!;
    expect(loaded).toMatchObject({ rootOnly: false, errorsOnly: false, expression: 'isRoot = true OR has_error = true' });
  });
  it('keeps unsupported query shapes on the full saved-view screen without altering explorer state', () => {
    const base = saved('traces');
    const variants: SavedView[] = [
      { ...base, source: 'metrics' },
      { ...base, spec: { ...base.spec, panelType: 'graph', requestType: 'time_series' } },
      { ...base, spec: { ...base.spec, panelType: 'trace', requestType: 'trace' } },
      { ...base, spec: { ...base.spec, queries: [...base.spec.queries, ...base.spec.queries] } },
      ...[
        { order: [{ key: { name: 'timestamp' }, direction: 'asc' }] },
        { offset: 100 }, { having: { expression: 'count > 10' } }, { functions: [{ name: 'topK' }] },
      ].map((extra) => ({ ...base, spec: { ...base.spec, queries: [{ ...base.spec.queries[0], spec: { ...base.spec.queries[0].spec, ...extra } }] } })),
      { ...base, spec: { ...base.spec, queries: [{ type: 'clickhouse_sql', spec: { query: 'SELECT *' } }] } },
    ];
    for (const view of variants) expect(openSavedExplorer(view)).toBe(false);
    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(explorer.get('traces').saved).toBeUndefined();
  });
});


describe('server-serialized saved views', () => {
  it('opens Migrations with both lowercase IN filters and nullable defaults in the logs explorer', () => {
    const view: SavedView = { id: 'migrations', source: 'logs', schemaVersion: 'v2', spec: migrations as ViewSpec };
    expect(openSavedExplorer(view)).toBe(true);
    expect(router.dismissTo).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/logs' }));
    const state = explorer.get('logs');
    expect(state.clauses).toEqual([
      { kind: 'filter', key: 'creditapp.job', op: 'IN', values: ['post-deploy'] },
      { kind: 'filter', key: 'body.message', op: 'IN', values: ['Backfill progress', 'Migration progress', 'Denormalizer migrated', 'Denormalizer backfilled', 'Migrating denormalizer', 'Backfilling denormalizer'] },
    ]);
    const current = viewSpecFromQuery('logs', logsQuery(range, { expression: explorer.expression('logs') }, 50, 0));
    expect(mergeExplorerView(view, state.saved!.baseline, current)).toBe(view.spec);
    explorer.add('logs', { kind: 'filter', key: 'service.name', op: '=', value: 'worker' });
    const edited = viewSpecFromQuery('logs', logsQuery(range, { expression: explorer.expression('logs') }, 50, 0));
    const merged = mergeExplorerView(view, state.saved!.baseline, edited);
    expect(merged.selectedFields).toEqual(migrations.selectedFields);
    expect(merged.display).toEqual(migrations.display);
    expect(merged.queries[0].spec).toMatchObject({ source: '', functions: null, secondaryAggregations: null, aggregations: null, groupBy: null, order: null, selectFields: null });
    expect(merged.queries[0].spec.filter).toEqual(edited.queries[0].spec.filter);
  });
  it('accepts empty optional defaults but continues rejecting active or malformed options', () => {
    const view: SavedView = { id: 'migrations', source: 'logs', schemaVersion: 'v2', spec: migrations as ViewSpec };
    const withOptions = (extra: Record<string, unknown>): SavedView => ({ ...view, spec: { ...view.spec, queries: [{ ...view.spec.queries[0], spec: { ...view.spec.queries[0].spec, ...extra } }] } });
    expect(asExplorerView(withOptions({ source: null, functions: [], secondaryAggregations: [], aggregations: [], groupBy: [], order: [], offset: null }))).not.toBeNull();
    for (const extra of [{ source: 'meter' }, { functions: [{ name: 'topK' }] }, { secondaryAggregations: [{ expression: 'sum()' }] }, { functions: {} }, { order: {} }, { groupBy: {} }, { futureOption: null }]) {
      expect(asExplorerView(withOptions(extra))).toBeNull();
    }
  });
  it('keeps all of CBB Lookups intact for the full-query preview instead of showing just A or B', () => {
    const view: SavedView = { id: 'cbb', source: 'traces', schemaVersion: 'v2', spec: cbbLookups as ViewSpec };
    expect(openSavedExplorer(view)).toBe(false);
    expect(router.dismissTo).not.toHaveBeenCalled();
    const request = savedViewQuery(view.spec, range);
    expect(request.requestType).toBe('scalar');
    expect(request.compositeQuery.queries).toEqual(cbbLookups.queries);
    expect(request.compositeQuery.queries[2].spec.expression).toBe('B -> A');
  });
});


describe('saved chart navigation handoff', () => {
  it('ignores old screen params between loading Apollo and receiving the new route', () => {
    const stale = { saved: 'previous-view', q: "service.name = 'old'", n: 'old', last: '3600000' };
    applyRouteFilter('traces', stale);
    const view: SavedView = { id: 'apollo', source: 'traces', schemaVersion: 'v2', spec: apollo as ViewSpec };
    expect(openSavedExplorer(view, { last: '604800000' })).toBe(true);
    const destination = vi.mocked(router.dismissTo).mock.calls[0][0] as unknown as { params: ExploreParams };
    applyRouteFilter('traces', stale); // A store update re-renders the old tab before dismissTo lands.
    expect(explorer.get('traces').aggregate?.queries[0].spec.aggregations).toEqual([{ expression: 'p90(creditapp.apollo_cache.bytes)' }]);
    expect(paramsLanded('traces', stale)).toBe(false);
    applyRouteFilter('traces', destination.params);
    expect(explorer.get('traces').pendingRouteSig).toBeUndefined();
    expect(paramsLanded('traces', destination.params)).toBe(true);
    expect(explorer.get('traces').aggregate?.panelType).toBe('graph');
    expect(destination.params.last).toBe('604800000');
    // A real subsequent navigation must still work.
    applyRouteFilter('traces', { q: "name = 'other'", n: 'new' });
    expect(explorer.get('traces').aggregate).toBeUndefined();
  });
  it('keeps the aggregate return target when drilldown changes the route time window', () => {
    openSavedExplorer({ id: 'apollo', source: 'traces', schemaVersion: 'v2', spec: apollo as ViewSpec });
    const destination = vi.mocked(router.dismissTo).mock.calls[0][0] as unknown as { params: ExploreParams };
    applyRouteFilter('traces', destination.params);
    const next = { ...destination.params, last: undefined, from: '1000', to: '2000' };
    explorer.stageRoute('traces', exploreSignature(next));
    explorer.drillAggregate('traces', []);
    applyRouteFilter('traces', destination.params);
    applyRouteFilter('traces', next);
    expect(explorer.get('traces').aggregateReturn?.aggregate?.panelType).toBe('graph');
    explorer.restoreAggregate('traces');
    expect(explorer.get('traces').aggregate?.panelType).toBe('graph');
  });
});
