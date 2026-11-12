import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from './card';
import { Chip } from './chip';
import { Field, Sheet } from './filter-editor';
import { LineChart } from './line-chart';
import { MetricViewEditor } from './metric-view-editor';
import { Empty, ErrorState, Loading } from './query-state';
import { RangeChip } from './range-chip';
import { EditViewForm, SaveViewForm, viewRangeParams } from './saved-views';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { useViewPermission } from '@/hooks/use-view-permission';
import { useWindowAnchor } from '@/hooks/use-window-anchor';
import { useClient } from '@/lib/auth';
import { formatMetricQuery, isMetricExplorerView, metricQueryUnit, metricViewRequest, metricViewResults, validateMetricSpec, type MetricAggregation } from '@/lib/metric-view';
import { listMetrics, queryRange } from '@/lib/signoz/api';
import { rangeFor, rangeSpecFromParams, resolveRange, type RangeSpec } from '@/lib/signoz/queries';
import type { MetricInfo, QueryRangeData } from '@/lib/signoz/types';
import { getView, type QueryEnvelope, type SavedView, type ViewSpec } from '@/lib/signoz/views';

export type MetricViewParams = { saved?: string; n?: string; last?: string; from?: string; to?: string; prefix?: string };
export function MetricSavedExplorer({ params }: { params: MetricViewParams }) {
  const client = useClient();
  const view = useQuery({ queryKey: ['saved-view', client.endpoint, params.saved], queryFn: ({ signal }) => getView(client, params.saved!, signal) });
  if (view.isPending) return <Loading />;
  if (view.isError) return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;
  if (!isMetricExplorerView(view.data)) return <View style={{ padding: Spacing.three, gap: 12 }}>
    <Empty title="This view needs the full preview" />
    <Link href={{ pathname: '/views/[id]', params: { id: view.data.id, last: params.last, from: params.from, to: params.to } }}><ThemedText color="accent">Open full preview →</ThemedText></Link>
    <Chip label="Browse metrics" onPress={() => router.setParams({ saved: undefined, prefix: undefined })} />
  </View>;
  return <MetricExplorer key={`${client.endpoint}:${params.saved}:${params.n}`} initial={view.data} initialRange={rangeSpecFromParams(params) ?? { key: '1h' }} />;
}
function MetricExplorer({ initial, initialRange }: { initial: SavedView; initialRange: RangeSpec }) {
  const client = useClient();
  const cache = useQueryClient();
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState<SavedView | undefined>(initial);
  const [spec, setSpec] = useState(initial.spec);
  const [range, setRange] = useState(initialRange);
  const [editing, setEditing] = useState<'native' | 'advanced'>();
  const [saveMode, setSaveMode] = useState<'update' | 'copy'>();
  const [notice, setNotice] = useState('');
  const create = useViewPermission({ action: 'create' });
  const update = useViewPermission({ action: 'update', id: saved?.id ?? initial.id });
  const dirty = !!saved && JSON.stringify(spec) !== JSON.stringify(saved.spec);
  const [anchor, refresh] = useWindowAnchor(JSON.stringify([range, spec]));
  const resolved = resolveRange(range, anchor);
  const results = useQuery({ queryKey: ['metric-view-results', client.endpoint, spec, resolved],
    queryFn: ({ signal }) => queryRange(client, metricViewRequest(spec, resolved), signal), gcTime: 60_000 });
  const catalog = useQuery({ queryKey: ['metrics', client.endpoint], queryFn: ({ signal }) => listMetrics(client, '', rangeFor('24h'), signal), staleTime: 300_000 });
  const visibleQueries = spec.queries.filter((q) => q.spec.disabled !== true);
  function apply(next: ViewSpec) {
    validateMetricSpec(next); setSpec(next); setEditing(undefined); setNotice('');
  }
  return <>
    <Stack.Screen options={{ title: saved ? spec.displayName : 'Metric query', headerLargeTitleEnabled: false }} />
    <FlatList data={results.isSuccess ? visibleQueries : []} keyExtractor={(q) => String(q.spec.name)} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: Spacing.three, paddingBottom: insets.bottom + Spacing.three, gap: Spacing.three }}
      refreshControl={<RefreshControl refreshing={results.isRefetching} onRefresh={refresh} />}
      ListHeaderComponent={<View style={{ gap: 10 }}>
        <ThemedText type="heading">{spec.displayName}{dirty ? ' · Unsaved changes' : ''}</ThemedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="Saved views" onPress={() => router.push({ pathname: '/views', params: { source: 'metrics', ...viewRangeParams(range) } })} />
          <Chip label="Browse metrics" onPress={() => router.setParams({ saved: undefined, prefix: undefined, n: undefined, last: undefined, from: undefined, to: undefined })} />
          <Chip label="Configure" onPress={() => setEditing('native')} />
          <Chip label="Advanced" onPress={() => setEditing('advanced')} />
          {create.allowed ? <Chip label={saved ? 'Save a copy' : 'Save view'} onPress={() => setSaveMode('copy')} /> : null}
          {saved && update.allowed ? <Chip label="Update view" onPress={() => setSaveMode('update')} /> : null}
          {dirty && saved ? <Chip label="Discard changes" onPress={() => { setSpec(saved.spec); setNotice(''); }} /> : null}
          {saved ? <Chip label="Leave view" onPress={() => setSaved(undefined)} /> : null}
        </View>
        {create.isError || (saved && update.isError) ? <><ThemedText type="caption">Save permissions could not be verified.</ThemedText><Chip label="Retry permissions" onPress={() => { void create.refetch(); void update.refetch(); }} /></> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <RangeChip value={range} onChange={(key) => setRange({ key })} />
          {(['graph', 'table', 'value'] as const).map((panelType) => <Chip key={panelType} label={panelType === 'graph' ? 'Chart' : panelType === 'table' ? 'Table' : 'Value'} selected={spec.panelType === panelType} onPress={() => setSpec({ ...spec, panelType, requestType: panelType === 'graph' ? 'time_series' : 'scalar' })} />)}
        </View>
        <ThemedText type="caption">{spec.queries.length} queries · {visibleQueries.length} outputs. Display units are local; saved query settings remain intact.</ThemedText>
        {notice ? <ThemedText type="caption">{notice}</ThemedText> : null}
        {catalog.isError ? <ThemedText type="caption">Metric units could not be loaded. Choose a display unit on each result.</ThemedText> : null}
        {results.isPending ? <Loading /> : results.isError ? <ErrorState error={results.error} onRetry={() => void results.refetch()} /> : null}
      </View>}
      renderItem={({ item }) => <MetricQueryResult spec={spec} query={item} data={results.data} metrics={catalog.data ?? []} range={resolved} />} />
    {editing === 'native' ? <MetricViewEditor initial={spec} onClose={() => setEditing(undefined)} onApply={apply} /> : null}
    {editing === 'advanced' ? <EditViewForm initial={spec} onClose={() => setEditing(undefined)} onApply={apply} /> : null}
    {saveMode ? <SaveViewForm source="metrics" initial={spec} id={saveMode === 'update' ? saved?.id : undefined} onClose={() => setSaveMode(undefined)} onSaved={(id, next) => {
      const view: SavedView = { ...(saved?.id === id ? saved : {}), id, source: 'metrics', schemaVersion: 'v2', spec: next };
      cache.setQueryData(['saved-view', client.endpoint, id], view);
      setSaved(view); setSpec(next); setSaveMode(undefined); setNotice('Saved to SigNoz.');
      if (id !== initial.id) router.setParams({ saved: id, ...viewRangeParams(range) });
    }} /> : null}
  </>;
}

function MetricQueryResult({ spec, query, data, metrics, range }: { spec: ViewSpec; query: QueryEnvelope; data?: QueryRangeData; metrics: MetricInfo[]; range: { startMs: number; endMs: number } }) {
  const [limit, setLimit] = useState(20);
  const [unit, setUnit] = useState<string>();
  const [unitPicker, setUnitPicker] = useState(false);
  let parsed: ReturnType<typeof metricViewResults>;
  try { parsed = metricViewResults(spec, data); } catch (e) { return <ErrorState error={e} />; }
  const series = parsed.series.filter((s) => s.query.spec.name === query.spec.name);
  const rows = parsed.rows.filter((r) => r.query.spec.name === query.spec.name);
  const chart = spec.requestType === 'time_series';
  const inferred = metricQueryUnit(query, metrics);
  const format = (value: number) => formatMetricQuery(value, query, metrics, unit);
  const metricNames = [...new Set(((query.spec.aggregations ?? []) as MetricAggregation[]).map((a) => a.metricName))];
  return <Card>
    <ThemedText type="heading">Query {String(query.spec.name)}</ThemedText>
    <ThemedText type="caption">{query.type === 'builder_formula' ? String(query.spec.expression) : metricNames.join(' · ')}</ThemedText>
    <Chip label={`Units: ${unit === undefined ? inferred ? `${inferred.unit || 'number'}${inferred.rate ? '/s' : ''} (auto)` : 'number (auto)' : unit || 'number'}`} onPress={() => setUnitPicker(true)} />
    {chart ? <LineChart series={series.slice(0, 50).map((s) => s.series)} format={format} height={200} legend /> : null}
    {series.length > 50 && chart ? <ThemedText type="caption">Chart shows the first 50 of {series.length} series.</ThemedText> : null}
    {chart ? series.slice(0, limit).map((s, i) => <View key={i}><ThemedText type="small">{s.series.name}</ThemedText><ThemedText type="mono">Latest: {s.series.points.length ? format(s.series.points.at(-1)!.v) : '—'}</ThemedText></View>) : rows.slice(0, limit).map((row, i) => <View key={i} style={{ gap: 8 }}>
      <ThemedText type="small">{Object.entries(row.groups).map(([key, value]) => `${key}: ${value ?? '(not set)'}`).join(' · ') || 'All matching series'}</ThemedText>
      {row.values.map((v, n) => <View key={n}><ThemedText type="caption">{v.name}</ThemedText><ThemedText type="mono">{typeof v.value === 'number' ? format(v.value) : String(v.value ?? '—')}</ThemedText></View>)}
    </View>)}
    {!(chart ? series.length : rows.length) ? <ThemedText type="caption">No data in this range.</ThemedText> : null}
    {(chart ? series.length : rows.length) > limit ? <Chip label={`Show more (${limit} of ${chart ? series.length : rows.length})`} onPress={() => setLimit(limit + 20)} /> : null}
    {metricNames.map((name) => {
      const info = metrics.find((m) => m.name === name) ?? metrics.find((m) => `${m.name}.bucket` === name);
      return <Link key={name} href={{ pathname: '/metrics/[name]', params: { name: info?.name ?? name, type: info?.type, unit: info?.unit, monotonic: info ? info.isMonotonic ? '1' : '0' : undefined, ...viewRangeParams(range) } }}><ThemedText color="accent" type="small">Open {name} →</ThemedText></Link>;
    })}
    {unitPicker ? <MetricUnitPicker initial={unit} onClose={() => setUnitPicker(false)} onApply={(next) => { setUnit(next); setUnitPicker(false); }} /> : null}
  </Card>;
}
function MetricUnitPicker({ initial, onClose, onApply }: { initial?: string; onClose: () => void; onApply: (unit: string | undefined) => void }) {
  const [unit, setUnit] = useState(initial);
  return <Sheet visible title="Display units" onClose={onClose} onApply={() => onApply(unit)} canApply>
    <Chip label="Automatic from metric metadata" selected={unit === undefined} onPress={() => setUnit(undefined)} />
    {['', '%', 'percentunit', 'By', 'By/s', 'ns', 'us', 'ms', 's', '{req}/s'].map((value) => <Chip key={value} label={value || 'Plain number'} selected={unit === value} onPress={() => setUnit(value)} />)}
    <Field label="Unit" value={unit ?? ''} onChangeText={setUnit} />
    <ThemedText type="caption">This changes display formatting only. It does not change the query or the saved view.</ThemedText>
  </Sheet>;
}
