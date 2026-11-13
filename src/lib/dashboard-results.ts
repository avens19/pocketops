import { aggregateDrillClauses, aggregateSeries } from './aggregate-view';
import { clauseToExpression, clausesToExpression, parseExpression } from './filters';
import { formatUnit, formatValue } from './format';
import { panelQueries, type DashboardPanel, type DashboardValues } from './signoz/dashboards';
import { quote } from './signoz/queries';
import type { QueryRangeData, Series } from './signoz/types';
import type { QueryEnvelope, ViewSpec } from './signoz/views';

type Aggregation = { expression?: string; metricName?: string; alias?: string };
export interface DashboardResultRow {
  query: QueryEnvelope; groups: Record<string, unknown>;
  values: { name: string; value: unknown; unit?: string }[];
}
export interface DashboardResultSeries { query: QueryEnvelope; groups: Record<string, unknown>; series: Series }
function viewForQuery(query: QueryEnvelope): ViewSpec {
  const aggs = (query.spec.aggregations ?? []) as Aggregation[];
  return { displayName: '', panelType: 'graph', requestType: 'time_series', queries: [{ ...query, spec: { ...query.spec,
    aggregations: aggs.length ? aggs.map((a) => ({ ...a, expression: a.expression || a.metricName || 'Value' })) : [{ expression: String(query.spec.expression || query.spec.name) }],
  } }] };
}
export function dashboardResults(panel: DashboardPanel, data?: QueryRangeData) {
  const { queries } = panelQueries(panel);
  const rows: DashboardResultRow[] = [];
  const series: DashboardResultSeries[] = [];
  const formatting = panel.spec.plugin.spec.formatting as { columnUnits?: Record<string, string> } | undefined;
  for (const raw of data?.data?.results ?? []) {
    const result = raw as { queryName?: string; columns?: { name: string; columnType?: string; aggregationIndex?: number }[]; data?: unknown[][] };
    const query = queries.find((q) => q.spec.name === result.queryName) ?? (queries.length === 1 && !result.queryName ? queries[0] : undefined);
    if (!query) throw new Error('The server returned a result with an unknown query name.');
    if (query.spec.disabled === true) continue;
    const view = viewForQuery(query);
    const aggs = (query.spec.aggregations ?? []) as Aggregation[];
    const legend = typeof query.spec.legend === 'string' ? query.spec.legend.trim() : '';
    for (const s of aggregateSeries({ data: { results: [result] } }, view)) {
      // A legend is the whole series name, as in SigNoz; without one, the query name tells composite results apart.
      const name = legend && aggs.length <= 1 ? legend.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => String(s.groups[key.trim()] ?? '(not set)'))
        : queries.filter((q) => !q.spec.disabled).length > 1 ? `${query.spec.name} · ${s.series.name}` : s.series.name;
      series.push({ ...s, query, series: { ...s.series, name } });
    }
    const groupNames = ((query.spec.groupBy ?? []) as { name: string }[]).map((g) => g.name);
    for (const row of result.data ?? []) {
      const groups: Record<string, unknown> = {};
      const values: DashboardResultRow['values'] = [];
      for (const [i, col] of (result.columns ?? []).entries()) {
        if (col.columnType !== 'aggregation' && groupNames.includes(col.name)) { groups[col.name] = row[i]; continue; }
        const a = aggs[col.aggregationIndex ?? values.length];
        const key = aggs.length > 1 ? `${query.spec.name}.${a?.expression || a?.metricName}` : String(query.spec.name);
        values.push({ name: a?.alias || a?.expression || a?.metricName || col.name, value: row[i], unit: formatting?.columnUnits?.[key] });
      }
      rows.push({ query, groups, values });
    }
  }
  return { rows, series };
}
export function dashboardFormat(value: number, unit?: string, precision?: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'percentunit') return `${formatValue(value * 100)}%`;
  if (unit === '{req}/s') return `${formatValue(value)} req/s`;
  if (unit && unit !== '1') return formatUnit(value, unit);
  return precision && /^[0-4]$/.test(precision) ? value.toFixed(Number(precision)) : precision === 'full' ? String(value) : formatValue(value);
}

/** Resolve only forms that can be faithfully carried into the explorer. Query execution itself uses server-side variables. */
export function drillExpression(query: QueryEnvelope, values: DashboardValues, groups: Record<string, unknown>): string | null {
  if (query.type !== 'builder_query' || !['traces', 'logs'].includes(String(query.spec.signal))) return null;
  const expression = (query.spec.filter as { expression?: string } | undefined)?.expression ?? '';
  const parts: string[] = [];
  for (const clause of parseExpression(expression)) {
    const original = clauseToExpression(clause);
    // Dynamic All removes a whole filter, never a quoted literal or part of an OR expression.
    const all = /^[\w.@:/-]+\s+(?:NOT\s+IN|IN|=|!=)\s+\$([\w.-]+)$/i.exec(original);
    if (all && values[all[1]]?.type === 'dynamic' && values[all[1]].value === '__all__') continue;
    let output = ''; let quoted = ''; let failed = false;
    for (let i = 0; i < original.length; i++) {
      const ch = original[i];
      if (quoted) {
        output += ch;
        if (ch === '\\') output += original[++i] ?? '';
        else if (ch === quoted) quoted = '';
      } else if (ch === "'" || ch === '"' || ch === '`') { quoted = ch; output += ch; }
      else if (ch === '$') {
        const name = /^[\w.-]+/.exec(original.slice(i + 1))?.[0];
        const variable = name ? values[name] : undefined;
        if (!variable || (variable.type === 'dynamic' && variable.value === '__all__')) { failed = true; break; }
        const isList = /\bIN\s*$/i.test(output);
        const selected = Array.isArray(variable.value) ? variable.value : [variable.value];
        if (!selected.length || (!isList && selected.length !== 1)) { failed = true; break; }
        output += isList ? `[${selected.map(quote).join(', ')}]` : quote(selected[0]);
        i += name!.length;
      } else output += ch;
    }
    if (failed) return null;
    parts.push(output);
  }
  const clauses = aggregateDrillClauses(viewForQuery(query), groups);
  if (clauses === null) return null;
  return clausesToExpression([...parts.map((text) => ({ kind: 'raw' as const, text })), ...clauses]);
}
