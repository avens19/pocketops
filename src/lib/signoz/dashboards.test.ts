import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/dashboard-performance.json';
import { SignozClient } from './client';
import { dashboardPanelRequest, dashboardSections, defaultVariables, getDashboard, listDashboards, panelQueries, sortVariableOptions, variableOptions, variableProblem, type Dashboard, type DashboardVariable } from './dashboards';
import { dashboardFormat, dashboardResults, drillExpression } from '../dashboard-results';

const dashboard = { id: 'performance', name: 'performance', ...fixture } as Dashboard;
const variables = defaultVariables(dashboard.spec.variables!);
const range = { startMs: 1000, endMs: 3601000 };
const panel = (id: string) => dashboard.spec.panels[id];
function client(data: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: status < 400 ? 'success' : 'error', data }), { status }));
  return { api: new SignozClient({ endpoint: 'https://example.com', apiKey: 'key' }, fetcher as unknown as typeof fetch), fetcher };
}

describe('dashboard API and complete performance export', () => {
  it('requests paginated dashboard summaries and escaped search', async () => {
    const { api, fetcher } = client({ dashboards: [], total: 0 });
    expect(await listDashboards(api, "owner's", 50)).toEqual({ dashboards: [], total: 0 });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v2/dashboards');
    expect(url.searchParams.get('offset')).toBe('50');
    expect(url.searchParams.get('query')).toBe("name CONTAINS 'owner\\'s'");
  });
  it('fetches encoded IDs and rejects legacy bodies rather than showing empty dashboards', async () => {
    const { api, fetcher } = client(dashboard);
    expect(await getDashboard(api, 'a/b')).toEqual(dashboard);
    expect(fetcher.mock.calls[0][0]).toBe('https://example.com/api/v2/dashboards/a%2Fb');
    await expect(getDashboard(client({ widgets: [] }).api, 'old')).rejects.toThrow('format');
    await expect(getDashboard(client({}, 403).api, 'private')).rejects.toMatchObject({ kind: 'forbidden' });
  });
  it('places all 41 panels in their nine sections, in grid reading order', () => {
    const sections = dashboardSections(dashboard);
    expect(sections).toHaveLength(9);
    expect(sections.flatMap((s) => s.panels)).toHaveLength(41);
    expect(sections[1].panels.slice(0, 2)).toEqual(['http-latency-percentiles', 'http-latency-p95-by-service']);
    expect(sections[8].title).toBe('Runtime and capacity');
  });
  it('constructs every data panel without mutating formulas, disabled inputs, or filters', () => {
    const original = JSON.stringify(dashboard);
    const requests = Object.values(dashboard.spec.panels).filter((p) => p.spec.plugin.kind !== 'signoz/TextPanel').map((p) => dashboardPanelRequest(p, variables, range));
    expect(requests).toHaveLength(40);
    expect(requests.filter((r) => r.compositeQuery.queries.some((q) => q.type === 'builder_formula'))).toHaveLength(4);
    const formula = dashboardPanelRequest(panel('cpu-percent-of-limit'), variables, range);
    expect(formula.compositeQuery.queries.map((q) => q.spec.disabled)).toEqual([true, true, false]);
    expect(formula.compositeQuery.queries[2].spec.expression).toBe('A / B * 100');
    expect(formula.compositeQuery.queries[0].spec.limit).toBeUndefined();
    expect(formula.compositeQuery.queries[0].spec.stepInterval).toBe(60);
    expect(JSON.stringify(dashboard)).toBe(original);
  });
  it('keeps dynamic All server-side and handles single/multiple defaults', () => {
    expect(variables).toEqual({ env: { type: 'dynamic', value: 'production' }, service: { type: 'dynamic', value: '__all__' } });
    expect(dashboardPanelRequest(panel('http-throughput'), variables, range).variables).toBe(variables);
    expect(variableProblem(dashboard.spec.variables!, variables)).toBeUndefined();
    expect(variableProblem(dashboard.spec.variables!, { ...variables, env: { type: 'dynamic', value: '' } })).toContain('env');
    const unsupported = [{ kind: 'ListVariable', spec: { name: 'query', plugin: { kind: 'signoz/QueryVariable', spec: {} } } }];
    expect(variableProblem(unsupported, {})).toContain('unsupported');
  });
  it('loads searchable dynamic values and preserves number-looking strings', async () => {
    const { api, fetcher } = client({ values: { stringValues: ['001', 'prod'], numberValues: [42] } });
    expect(await variableOptions(api, dashboard.spec.variables![0], range, 'p')).toEqual(['001', '42', 'prod']);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('signal')).toBe('metrics');
    expect(url.searchParams.get('name')).toBe('k8s.namespace.name');
    expect(url.searchParams.get('searchText')).toBe('p');
    expect(url.searchParams.get('limit')).toBe('200');
    expect(sortVariableOptions(['2', '10', '1', '2'], 'numerical-desc')).toEqual(['10', '2', '1']);
    const custom: DashboardVariable = { kind: 'ListVariable', spec: { name: 'fixed', plugin: { kind: 'signoz/CustomVariable', spec: { customValue: 'a, b, c' } } } };
    expect(await variableOptions(api, custom, range, 'b')).toEqual(['b']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('honors panel-specific ranges and explicit steps', () => {
    const p = structuredClone(panel('http-throughput'));
    p.spec.plugin.spec.visualization = { timePreference: 'last_5_min' };
    p.spec.queries[0].spec.plugin.spec.stepInterval = 30;
    const request = dashboardPanelRequest(p, variables, range);
    expect(request.start).toBe(range.endMs - 300000);
    expect(request.compositeQuery.queries[0].spec.stepInterval).toBe(30);
  });
  it('fails visibly for unsupported plugins, duplicate names and query kinds', () => {
    const p = structuredClone(panel('http-throughput'));
    p.spec.queries.push(p.spec.queries[0]);
    expect(() => panelQueries(p)).toThrow('duplicate');
    p.spec.plugin.kind = 'signoz/HeatmapPanel';
    expect(() => panelQueries(p)).toThrow('panel type');
    p.spec.plugin.kind = 'signoz/TimeSeriesPanel'; p.spec.queries[0].kind = 'raw';
    expect(() => panelQueries(p)).toThrow('query type');
  });
});

describe('dashboard rendering and trace drilldown', () => {
  it('renders all composite results by query name, including formulas when inputs are hidden', () => {
    const result = (name: string, value: number) => ({ queryName: name, aggregations: [{ index: 0, series: [{ labels: [{ key: { name: 'k8s.container.name' }, value: 'api' }], values: [{ timestamp: 1000, value }] }] }] });
    const parsed = dashboardResults(panel('cpu-percent-of-limit'), { data: { results: [result('F1', 50), result('B', 2), result('A', 1)] } });
    expect(parsed.series).toHaveLength(1);
    expect(parsed.series[0].series.points[0].v).toBe(50);
    expect(parsed.series[0].query.type).toBe('builder_formula');
    expect(drillExpression(parsed.series[0].query, variables, parsed.series[0].groups)).toBeNull();
    const multi = dashboardResults(panel('public-api-throughput'), { data: { results: [result('C', 3), result('A', 1), result('B', 2)] } });
    expect(multi.series.map((s) => s.query.spec.name)).toEqual(['C', 'A', 'B']);
    expect(() => dashboardResults(panel('public-api-throughput'), { data: { results: [result('unknown', 1)] } })).toThrow('query name');
  });
  it('uses expression keys for per-column units and indexes for aliases', () => {
    const result = dashboardResults(panel('slowest-pages'), { data: { results: [{ queryName: 'A', columns: [
      { name: 'http.route', columnType: 'group' }, { name: '__result_1', columnType: 'aggregation', aggregationIndex: 1 },
      { name: '__result_2', columnType: 'aggregation', aggregationIndex: 2 }, { name: '__result_0', columnType: 'aggregation', aggregationIndex: 0 },
    ], data: [['/home', 2000000, 42, 1000000]] }] } });
    expect(result.rows[0].values).toEqual([{ name: 'p99', value: 2000000, unit: 'ns' }, { name: 'spans', value: 42, unit: undefined }, { name: 'p95', value: 1000000, unit: 'ns' }]);
    expect(dashboardFormat(2000000, 'ns')).toBe('2.0 ms');
    expect(dashboardFormat(0.25, 'percentunit')).toBe('25.00%');
    expect(dashboardFormat(25, '%')).toBe('25.00%');
    expect(dashboardFormat(1024, 'By')).toBe('1.00 KB');
    expect(dashboardFormat(4, '{req}/s')).toBe('4.00 req/s');
  });
  it('resolves env in OR filters, removes dynamic All, and preserves original predicates and typed groups', () => {
    const query = panelQueries(panel('slowest-commands')).queries[0];
    const expression = drillExpression(query, variables, { 'log.commandName': "owner's" })!;
    expect(expression).toContain("resource.k8s.namespace.name = 'production'");
    expect(expression).not.toContain('$service');
    expect(expression).not.toContain('__all__');
    expect(expression).toContain("log.commandName = 'owner\\'s'");
    const publicApi = drillExpression(panelQueries(panel('public-api-slowest-endpoints')).queries[0], variables, { name: 'GET /' });
    expect(publicApi).toContain("(resource.k8s.namespace.name = 'production' OR resource.deployment.environment = 'production')");
    expect(drillExpression(query, variables, {})).toBeNull();
  });
  it('does not replace quoted variable text, guess missing variables, or broaden complex All filters', () => {
    const query = { type: 'builder_query', spec: { signal: 'traces', filter: { expression: "name = '$env' AND service.name IN $service" } } };
    expect(drillExpression(query, variables, {})).toBe("name = '$env'");
    expect(drillExpression({ ...query, spec: { ...query.spec, filter: { expression: '(service.name IN $service OR name = \'x\')' } } }, variables, {})).toBeNull();
    expect(drillExpression({ ...query, spec: { ...query.spec, filter: { expression: 'name = $missing' } } }, variables, {})).toBeNull();
    expect(drillExpression(query, { ...variables, service: { type: 'dynamic', value: ['001', "x' OR true"] } }, {})).toContain("['001', 'x\\' OR true']");
  });
});
