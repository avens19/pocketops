import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from './card';
import { Chip } from './chip';
import { Field, Sheet } from './filter-editor';
import { FilterBar } from './filter-bar';
import { LineChart } from './line-chart';
import { Empty, ErrorState, Loading } from './query-state';
import { RangeChip } from './range-chip';
import { SavedViewsBar, viewRangeParams } from './saved-views';
import { SearchField } from './search-field';
import { ThemedText } from './themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useDebounced } from '@/hooks/use-debounced';
import { useTheme } from '@/hooks/use-theme';
import { useWindowAnchor } from '@/hooks/use-window-anchor';
import { aggregateDrillClauses, aggregateFields, aggregateQuery, aggregateRows, aggregateSeries, aggregations, configureAggregate, FIELD_FUNCTIONS, fieldAggregation, type AggregateRow, type Aggregation, type FieldFunction } from '@/lib/aggregate-view';
import { useClient } from '@/lib/auth';
import { applyRouteFilter, exploreSignature, paramsLanded, type ExploreParams } from '@/lib/explore-links';
import { explorer, useExplorer, type ExplorerSignal } from '@/lib/explorer-state';
import { clausesToExpression, type Clause } from '@/lib/filters';
import { formatValue } from '@/lib/format';
import { fetchFieldKeys, queryRange } from '@/lib/signoz/api';
import { logFilterExpression, quote, rangeSpecFromParams, resolveRange, type RangeSpec, type TimeRange } from '@/lib/signoz/queries';
import { withViewFilter, type ViewSpec } from '@/lib/signoz/views';

export function AggregateExplorer({ source, initial, params }: { source: ExplorerSignal; initial: ViewSpec; params: ExploreParams }) {
  const client = useClient();
  const state = useExplorer(source);
  const aggregate = state.aggregate ?? initial;
  const [range, setRange] = useState<RangeSpec>(() => rangeSpecFromParams(params) ?? { key: '1h' });
  const [editing, setEditing] = useState(false);
  const sig = exploreSignature(params);
  useEffect(() => { applyRouteFilter(source, params); }, [source, params, sig]);
  const expression = clausesToExpression(state.clauses);
  const fullExpression = (text: string) => source === 'logs' ? logFilterExpression({ expression, text }) : [
    state.rootOnly ? 'isRoot = true' : '', state.errorsOnly ? 'has_error = true' : '',
    expression ? `(${expression})` : '', text ? `name CONTAINS ${quote(text)}` : '',
  ].filter(Boolean).join(' AND ');
  const current = withViewFilter(aggregate, 0, fullExpression(state.text.trim()));
  const debouncedText = useDebounced(state.text.trim(), 400);
  const querySpec = withViewFilter(aggregate, 0, fullExpression(debouncedText));
  const [anchor, refresh] = useWindowAnchor(JSON.stringify([range, querySpec]));
  const resolved = resolveRange(range, anchor);
  const results = useQuery({
    queryKey: ['explorer-aggregate', client.endpoint, querySpec, range, anchor],
    enabled: paramsLanded(source, params),
    queryFn: ({ signal }) => queryRange(client, aggregateQuery(querySpec, resolved), signal),
    gcTime: 60_000,
  });
  const chart = aggregate.requestType === 'time_series';
  const series = useMemo(() => aggregateSeries(results.data, querySpec), [results.data, querySpec]);
  const rows: AggregateRow[] = chart ? series.map(({ groups, series: s }) => ({ groups, values: [{ name: s.name, value: s.points.at(-1)?.v }] })) : aggregateRows(results.data, querySpec);
  const recordName = source === 'logs' ? 'logs' : 'spans';
  function drill(clauses: Clause[]) {
    // Carry the actual displayed time window into the list, including on a rolling range.
    const rangeParams = viewRangeParams(resolved);
    explorer.stageRoute(source, exploreSignature({ ...params, ...rangeParams }));
    router.setParams(rangeParams);
    explorer.drillAggregate(source, clauses);
  }
  return <>
    <FlatList data={results.isSuccess && state.text.trim() === debouncedText ? rows : []} keyExtractor={(_, i) => String(i)}
      contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={results.isRefetching} onRefresh={refresh} />}
      ListHeaderComponent={<View style={styles.header}>
        <SavedViewsBar source={source} range={range} spec={current} />
        <SearchField value={state.text} onChangeText={(text) => explorer.setText(source, text)} placeholder={source === 'logs' ? 'Search log messages' : 'Search span names'} />
        <FilterBar signal={source} range={resolved} />
        <View style={styles.row}>
          <RangeChip value={range} onChange={(key) => setRange({ key })} />
          <Chip label="Table" selected={!chart} onPress={() => explorer.setAggregate(source, { ...aggregate, panelType: 'table', requestType: 'scalar' })} />
          <Chip label="Chart" selected={chart} onPress={() => explorer.setAggregate(source, { ...aggregate, panelType: 'graph', requestType: 'time_series' })} />
          <Chip label="Configure" onPress={() => setEditing(true)} />
          <Chip label={`Show matching ${recordName}`} onPress={() => drill([])} />
          {source === 'traces' ? <>
            <Chip label="Errors" selected={state.errorsOnly} onPress={() => explorer.setErrorsOnly(source, !state.errorsOnly)} />
            <Chip label="Root spans" selected={state.rootOnly} onPress={() => explorer.setRootOnly(source, !state.rootOnly)} />
          </> : null}
        </View>
        <ThemedText type="caption">{aggregations(aggregate).map((a) => a.alias ? `${a.alias}: ${a.expression}` : a.expression).join(' · ')}</ThemedText>
        <ThemedText type="caption">{chart ? 'Select a series below to explore its' : 'Tap a row to explore its'} matching {recordName}. {Number(aggregate.queries[0].spec.limit) > 0 ? `Limit: ${aggregate.queries[0].spec.limit} groups.` : ''}</ThemedText>
        {results.isPending ? <Loading /> : results.isError ? <ErrorState error={results.error} onRetry={() => void results.refetch()} /> : chart ? <Card><LineChart series={series.map((s) => s.series)} height={200} legend /></Card> : null}
      </View>}
      ListEmptyComponent={results.isSuccess && !rows.length ? <Empty title="No results" hint="Try a wider time range or fewer filters." /> : undefined}
      renderItem={({ item }) => {
        const clauses = aggregateDrillClauses(aggregate, item.groups);
        const groupLabel = Object.entries(item.groups).map(([key, value]) => `${key}: ${value === null ? '(not set)' : String(value)}`).join(' · ') || 'All matching records';
        return <Pressable accessibilityRole="button" accessibilityLabel={`${groupLabel}. Show matching ${recordName}`} accessibilityState={{ disabled: clauses === null }} disabled={clauses === null} onPress={() => drill(clauses!)}>
          <Card>
            <ThemedText type="small" selectable={clauses === null}>{groupLabel}</ThemedText>
            <View style={styles.row}>{item.values.map((value, i) => <View key={i} style={styles.cell}>
              <ThemedText type="caption">{chart ? `${value.name} · Latest` : value.name}</ThemedText>
              <ThemedText type="mono">{typeof value.value === 'number' ? formatValue(value.value) : String(value.value ?? '—')}</ThemedText>
            </View>)}</View>
            <ThemedText type="caption" color={clauses === null ? 'textSecondary' : 'accent'}>{clauses === null ? 'Group values unavailable for drilldown' : `Show ${recordName} →`}</ThemedText>
          </Card>
        </Pressable>;
      }} />
    {editing ? <AggregateEditor source={source} range={resolved} initial={aggregate} onClose={() => setEditing(false)} onApply={(spec) => { explorer.setAggregate(source, spec); setEditing(false); }} /> : null}
  </>;
}

const AGGREGATION_PRESETS = [
  { label: 'Count', expression: 'count()', alias: 'count' },
  { label: 'Avg duration', expression: 'avg(duration_nano) / 1000000', alias: 'avg_ms' },
  { label: 'p50 duration', expression: 'p50(duration_nano) / 1000000', alias: 'p50_ms' },
  { label: 'p90 duration', expression: 'p90(duration_nano) / 1000000', alias: 'p90_ms' },
  { label: 'p95 duration', expression: 'p95(duration_nano) / 1000000', alias: 'p95_ms' },
  { label: 'p99 duration', expression: 'p99(duration_nano) / 1000000', alias: 'p99_ms' },
  { label: 'Max duration', expression: 'max(duration_nano) / 1000000', alias: 'max_ms' },
];

/** Choose a function, then search the fields seen in this window and tap a numeric one to aggregate it. */
function FieldPicker({ source, range, onPick }: { source: ExplorerSignal; range: TimeRange; onPick: (a: Aggregation) => void }) {
  const client = useClient();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [fn, setFn] = useState<FieldFunction>('avg');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 300);
  const windowKey = Math.floor(range.startMs / 60_000);
  const keys = useQuery({
    queryKey: ['field-keys', client.endpoint, source, debounced, windowKey],
    queryFn: ({ signal }) => fetchFieldKeys(client, source, debounced, range, signal),
    enabled: open, placeholderData: keepPreviousData, staleTime: 60_000,
  });
  if (!open) return <Chip label="Pick a field…" onPress={() => setOpen(true)} />;
  const numeric = (keys.data ?? []).filter((k) => /int|float|number/i.test(k.dataType)).slice(0, 12);
  return <View style={styles.header}>
    <View style={styles.row}>{FIELD_FUNCTIONS.map((f) => <Chip key={f} label={f} selected={fn === f} onPress={() => setFn(f)} />)}</View>
    <Field label="Numeric field" value={search} onChangeText={setSearch} placeholder="duration_nano" autoCapitalize="none" autoCorrect={false} />
    <View style={{ borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, overflow: 'hidden' }}>
      {keys.isPending ? <ThemedText type="caption" style={styles.pad}>Loading fields…</ThemedText> : numeric.length === 0 ? <ThemedText type="caption" style={styles.pad}>No numeric fields match.</ThemedText> : numeric.map((k, i) =>
        <Pressable key={k.name} accessibilityRole="button" onPress={() => { onPick(fieldAggregation(fn, k.name)); setOpen(false); setSearch(''); }}
          style={[styles.pad, styles.row, { justifyContent: 'space-between', borderTopColor: theme.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
          <ThemedText type="small" numberOfLines={1} style={{ flex: 1 }}>{k.name}</ThemedText>
          <ThemedText type="caption">{k.dataType}</ThemedText>
        </Pressable>)}
    </View>
    <Chip label="Cancel" onPress={() => setOpen(false)} />
  </View>;
}

function AggregateEditor({ source, range, initial, onClose, onApply }: { source: ExplorerSignal; range: TimeRange; initial: ViewSpec; onClose: () => void; onApply: (spec: ViewSpec) => void }) {
  const q = initial.queries[0].spec;
  const [items, setItems] = useState(aggregations(initial));
  const [groupBy, setGroupBy] = useState(aggregateFields(initial).map((f) => f.name).join(', '));
  const [limit, setLimit] = useState(String(Number(q.limit) > 0 ? q.limit : 50));
  const initialOrder = (q.order as { key: { name: string }; direction: 'asc' | 'desc' }[] | null)?.[0];
  const [sort, setSort] = useState(initialOrder?.key.name ?? '');
  const [direction, setDirection] = useState<'asc' | 'desc'>(initialOrder?.direction ?? 'desc');
  const [error, setError] = useState('');
  const sortFields = [...new Set([...items.map((a) => a.alias || a.expression), ...groupBy.split(',').map((s) => s.trim())].filter(Boolean))];
  function apply() {
    try {
      onApply(configureAggregate(initial, { aggregations: items, groupBy: groupBy.split(',').map((s) => s.trim()).filter(Boolean), limit: Number(limit), sort, direction }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <Sheet visible title="Configure view" onClose={onClose} onApply={apply} canApply>
    {items.map((item, index) => <View key={index} style={styles.header}>
      {source === 'traces' ? <View style={styles.row}>{AGGREGATION_PRESETS.map((p) => <Chip key={p.alias} label={p.label} selected={item.expression === p.expression}
        onPress={() => setItems(items.map((a, i) => i === index ? { ...a, expression: p.expression, alias: p.alias } : a))} />)}</View> : null}
      <FieldPicker source={source} range={range} onPick={(a) => setItems(items.map((x, i) => i === index ? { ...x, ...a } : x))} />
      <Field label={`Aggregation ${index + 1}`} value={item.expression} onChangeText={(expression) => setItems(items.map((a, i) => i === index ? { ...a, expression } : a))} placeholder="p90(duration_nano) / 1000000" />
      <Field label="Alias (optional)" value={item.alias ?? ''} onChangeText={(alias) => setItems(items.map((a, i) => i === index ? { ...a, alias } : a))} placeholder="p90_ms" />
      {items.length > 1 ? <Chip label="Remove aggregation" onPress={() => setItems(items.filter((_, i) => i !== index))} /> : null}
    </View>)}
    <Chip label="Add aggregation" onPress={() => setItems([...items, { expression: 'count()', alias: `value_${items.length + 1}` }])} />
    <Field label="Group by" value={groupBy} onChangeText={setGroupBy} placeholder="http.route, service.name" />
    <Field label="Group limit" value={limit} onChangeText={setLimit} keyboardType="number-pad" />
    <ThemedText type="caption">Sort by</ThemedText>
    <View style={styles.row}>
      <Chip label="Default" selected={!sort} onPress={() => setSort('')} />
      {sortFields.map((name) => <Chip key={name} label={name} selected={sort === name} onPress={() => setSort(name)} />)}
      <Chip label={direction === 'desc' ? 'Descending' : 'Ascending'} onPress={() => setDirection(direction === 'desc' ? 'asc' : 'desc')} />
    </View>
    <ThemedText type="caption">Presets show duration in milliseconds; type any expression for other fields, such as `avg(http.response.size)`. Aggregation expressions use SigNoz query syntax. Apply previews your changes; Update view saves them.</ThemedText>
    {error ? <ThemedText color="danger">{error}</ThemedText> : null}
  </Sheet>;
}
const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  header: { gap: Spacing.two, marginBottom: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pad: { padding: Spacing.three },
  cell: { minWidth: 90, flexGrow: 1, gap: 2 },
});
