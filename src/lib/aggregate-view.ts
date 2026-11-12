import { isValidKey, type Clause } from './filters';
import { stepSeconds, type TimeRange } from './signoz/queries';
import type { QueryRangeData, Series } from './signoz/types';
import { savedViewQuery, type QueryEnvelope, type ViewSpec } from './signoz/views';

export interface AggregateField { name: string; fieldContext?: string; fieldDataType?: string; [key: string]: unknown }
export interface Aggregation { expression: string; alias?: string; [key: string]: unknown }
export const aggregateFields = (spec: ViewSpec) => (spec.queries[0].spec.groupBy ?? []) as AggregateField[];
export const aggregations = (spec: ViewSpec) => spec.queries[0].spec.aggregations as Aggregation[];

/** A zero step means automatic in the web UI, but query_range needs a concrete bucket size. */
export function aggregateQuery(spec: ViewSpec, range: TimeRange) {
  const request = savedViewQuery(spec, range);
  return { ...request, compositeQuery: { queries: request.compositeQuery.queries.map((query): QueryEnvelope => ({ ...query, spec: {
    ...query.spec,
    ...(spec.requestType === 'time_series' && !(Number(query.spec.stepInterval) > 0) ? { stepInterval: stepSeconds(range) } : {}),
  } })) } };
}

export interface AggregateRow { groups: Record<string, unknown>; values: { name: string; value: unknown }[] }
export function aggregateRows(data: QueryRangeData | undefined, spec: ViewSpec): AggregateRow[] {
  const result = data?.data?.results?.[0] as { columns?: { name: string; columnType?: string; aggregationIndex?: number }[]; data?: unknown[][] } | undefined;
  if (!Array.isArray(result?.columns) || !Array.isArray(result?.data)) return [];
  const fields = aggregateFields(spec);
  const aggs = aggregations(spec);
  return result.data.map((row) => {
    const groups: Record<string, unknown> = {};
    const values: AggregateRow['values'] = [];
    result.columns!.forEach((column, i) => {
      const aggregation = column.columnType === 'aggregation';
      if (!aggregation && fields.some((field) => field.name === column.name)) groups[column.name] = row[i];
      else {
        const a = aggregation ? aggs[column.aggregationIndex ?? values.length] : undefined;
        values.push({ name: a?.alias || a?.expression || column.name, value: row[i] });
      }
    });
    return { groups, values };
  });
}

export interface AggregateSeries { series: Series; groups: Record<string, unknown> }
export function aggregateSeries(data: QueryRangeData | undefined, spec: ViewSpec): AggregateSeries[] {
  const result = data?.data?.results?.[0] as { aggregations?: { index?: number; alias?: string; series?: { labels?: { key?: { name?: string }; value?: unknown }[]; values?: { timestamp: number; value: number; partial?: boolean }[] }[] }[] } | undefined;
  const aggs = aggregations(spec);
  const legend = spec.queries[0].spec.legend;
  return (result?.aggregations ?? []).flatMap((a, i) => (a.series ?? []).map((s) => {
    const groups = Object.fromEntries((s.labels ?? []).filter((l) => l.key?.name).map((l) => [l.key!.name!, l.value]));
    const aggregation = aggs[a.index ?? i];
    const valueName = aggregation?.alias || aggregation?.expression || a.alias || 'Value';
    const groupName = typeof legend === 'string' && legend ? legend.replace(/\{\{([^}]+)\}\}/g, (_, name: string) => String(groups[name.trim()] ?? '(not set)')) : Object.values(groups).map((v) => String(v ?? '(not set)')).join(' · ');
    return { groups, series: {
      name: [groupName, valueName].filter(Boolean).join(' · '),
      labels: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, String(value ?? '')])),
      points: (s.values ?? []).filter((p) => !p.partial && Number.isFinite(p.value)).map((p) => ({ t: p.timestamp, v: p.value })).sort((a, b) => a.t - b.t),
    } };
  }));
}

/** Missing labels disable drilldown; a missing value is distinct from a missing response column. */
export function aggregateDrillClauses(spec: ViewSpec, groups: Record<string, unknown>): Clause[] | null {
  const clauses: Clause[] = [];
  for (const field of aggregateFields(spec)) {
    if (!isValidKey(field.name) || !Object.hasOwn(groups, field.name)) return null;
    const value = groups[field.name];
    if (value === null) clauses.push({ kind: 'filter', key: field.name, op: 'NOT EXISTS' });
    else if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) clauses.push({ kind: 'filter', key: field.name, op: '=', value });
    else return null;
  }
  return clauses;
}

export function configureAggregate(spec: ViewSpec, options: { aggregations: Aggregation[]; groupBy: string[]; limit: number; sort: string; direction: 'asc' | 'desc' }): ViewSpec {
  if (!options.aggregations.length || options.aggregations.some((a) => !a.expression.trim())) throw new Error('Enter at least one aggregation.');
  if (options.groupBy.some((name) => !isValidKey(name))) throw new Error('Use field names separated by commas for Group by.');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new Error('Limit must be between 1 and 1000.');
  const names = options.aggregations.map((a) => a.alias?.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) throw new Error('Aggregation aliases must be unique.');
  if (options.sort && ![...options.groupBy, ...options.aggregations.map((a) => a.alias?.trim() || a.expression.trim())].includes(options.sort)) throw new Error('Choose a sort field from the current groups or aggregations.');
  const query = spec.queries[0];
  const fields = aggregateFields(spec);
  const oldOrder = query.spec.order as { key: { name: string }; direction: string }[] | undefined;
  const orderKey = oldOrder?.find((o) => o.key.name === options.sort)?.key ?? { name: options.sort };
  return { ...spec, queries: [{ ...query, spec: { ...query.spec,
    aggregations: options.aggregations.map((a) => ({ ...a, expression: a.expression.trim(), alias: a.alias?.trim() || undefined })),
    groupBy: [...new Set(options.groupBy)].map((name) => fields.find((field) => field.name === name) ?? { name }),
    limit: options.limit,
    order: options.sort ? [{ key: orderKey, direction: options.direction }] : [],
  } }] };
}
