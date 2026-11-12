import { useQuery } from '@tanstack/react-query';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { LineChart } from '@/components/line-chart';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { RangeChip } from '@/components/range-chip';
import { EditViewForm, SaveViewForm, viewRangeParams } from '@/components/saved-views';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useViewPermission } from '@/hooks/use-view-permission';
import { isMetricExplorerView } from '@/lib/metric-view';
import { asExplorerView } from '@/lib/explorer-view';
import { openSavedExplorer } from '@/lib/open-saved-view';
import { useClient } from '@/lib/auth';
import { queryRange, toLogRow } from '@/lib/signoz/api';
import { parseRawRows, parseTimeSeries, rangeSpecFromParams, resolveRange, type RangeSpec } from '@/lib/signoz/queries';
import type { QueryRangeData, Series } from '@/lib/signoz/types';
import { getView, savedViewQuery, type SavedView, type ViewSpec } from '@/lib/signoz/views';

type ResultItem = { label: string; values?: Record<string, unknown>; series?: Series[]; traceId?: string };

/** Every query result is kept, including formula results; existing explorer parsers read only the first. */
function resultItems(data: QueryRangeData | undefined, spec: ViewSpec, source: string): ResultItem[] {
  return (data?.data?.results ?? []).flatMap<ResultItem>((value, index) => {
    const result = value as { queryName?: string; columns?: { name: string }[]; data?: unknown[][]; error?: unknown };
    const label = result.queryName ?? String(spec.queries[index]?.spec.name ?? index + 1);
    const response = { data: { results: [value] } };
    if (result.error) return [{ label, values: { error: result.error } }];
    if (spec.requestType === 'time_series') return [{ label, series: parseTimeSeries(response) }];
    if (spec.requestType === 'raw') return parseRawRows(response).map((row) => {
      const log = source === 'logs' ? toLogRow(row) : undefined;
      return { label, traceId: typeof row.data.trace_id === 'string' ? row.data.trace_id : undefined,
        values: log ? { timestamp: row.timestamp, ...row.data, service: log.service, severity: log.severity, body: log.bodyPretty } : { timestamp: row.timestamp, ...row.data } };
    });
    // Keep server column names, including aggregation aliases, for arbitrary table/value views.
    return (result.data ?? []).map((row) => ({ label, values: Object.fromEntries((result.columns ?? []).map((col, i) => [col.name || `Column ${i + 1}`, row[i]])) }));
  });
}

export default function SavedViewScreen() {
  const params = useLocalSearchParams<{ id: string; last?: string; from?: string; to?: string }>();
  const { id } = params;
  const client = useClient();
  const view = useQuery({ queryKey: ['saved-view', client.endpoint, id], queryFn: ({ signal }) => getView(client, id, signal) });
  const opened = useRef('');
  const canOpenExplorer = !!view.data && (isMetricExplorerView(view.data) || asExplorerView(view.data) !== null);
  useEffect(() => {
    if (!view.data || !canOpenExplorer || opened.current === id) return;
    opened.current = id;
    openSavedExplorer(view.data, { last: params.last, from: params.from, to: params.to });
  }, [view.data, canOpenExplorer, id, params.last, params.from, params.to]);
  if (view.isPending || canOpenExplorer) return <Loading />;
  if (view.isError) return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;
  return <ViewDetail key={`${client.endpoint}:${id}`} view={view.data} initialRange={rangeSpecFromParams(params) ?? { key: '1h' }} />;
}

function ViewDetail({ view, initialRange }: { view: SavedView; initialRange: RangeSpec }) {
  const client = useClient();
  const create = useViewPermission({ action: 'create' });
  const update = useViewPermission({ action: 'update', id: view.id });
  const [draft, setDraft] = useState<ViewSpec>();
  const [editing, setEditing] = useState(false);
  const [saveMode, setSaveMode] = useState<'update' | 'copy'>();
  const [range, setRange] = useState(initialRange);
  const [notice, setNotice] = useState('');
  const spec = draft ?? view.spec;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(view.spec);
  const supported = view.schemaVersion === 'v2' && ['raw', 'time_series', 'scalar'].includes(spec.requestType);
  const results = useQuery({
    queryKey: ['saved-view-results', client.endpoint, view.id, spec, range],
    enabled: supported,
    queryFn: ({ signal }) => queryRange(client, savedViewQuery(spec, resolveRange(range)), signal),
    gcTime: 60_000,
  });
  const items = useMemo(() => resultItems(results.data, spec, view.source), [results.data, spec, view.source]);
  return <>
    <Stack.Screen options={{ title: spec.displayName }} />
    <FlatList data={items} keyExtractor={(_, i) => String(i)} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
      refreshControl={<RefreshControl refreshing={results.isRefetching} onRefresh={() => { if (supported) void results.refetch(); }} />}
      ListHeaderComponent={<View style={{ gap: Spacing.two, marginBottom: Spacing.two }}>
        <ThemedText type="heading">{spec.displayName}</ThemedText>
        {view.source !== 'metrics' ? <ThemedText type="caption">This query uses options the standard explorer can’t represent. Showing the full saved query here.</ThemedText> : null}
        <RangeChip value={range} onChange={(key) => setRange({ key })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
          <Chip label="Edit view" onPress={() => setEditing(true)} />
          {update.allowed ? <Chip label="Update view" onPress={() => setSaveMode('update')} /> : null}
          {create.allowed ? <Chip label="Save a copy" onPress={() => setSaveMode('copy')} /> : null}
          {dirty ? <Chip label="Discard changes" onPress={() => { setDraft(undefined); setNotice(''); }} /> : null}
        </View>
        {create.isError || update.isError ? <>
          <ThemedText type="caption">Save permissions could not be verified. Saving is hidden until permission is confirmed.</ThemedText>
          <Chip label="Retry permission check" onPress={() => { void create.refetch(); void update.refetch(); }} />
        </> : null}
        {dirty ? <ThemedText type="caption">Unsaved changes</ThemedText> : null}
        {notice ? <ThemedText type="caption">{notice}</ThemedText> : null}
        {spec.requestType === 'raw' ? <ThemedText type="caption">Showing the result window configured in this view. Edit the query limit or time range to see more.</ThemedText> : null}
        {!supported ? <Empty title="This panel can’t be previewed here" hint="Trace-operator panels and newer schemas need the SigNoz web explorer. Your saved query is preserved." /> : results.isError ? <ErrorState error={results.error} onRetry={() => void results.refetch()} /> : results.isPending ? <Loading /> : null}
      </View>}
      ListEmptyComponent={supported && results.isSuccess ? <Empty title="No results" hint="Try a wider time range or edit the filters." /> : undefined}
      renderItem={({ item }) => <Card>
        <ThemedText type="caption">Query {item.label}</ThemedText>
        {item.series ? <LineChart series={item.series} height={180} legend /> : Object.entries(item.values ?? {}).filter(([, v]) => v !== undefined).map(([key, value]) => <View key={key}>
          <ThemedText type="caption">{key}</ThemedText>
          <ThemedText type="mono" selectable numberOfLines={8}>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '—')}</ThemedText>
        </View>)}
        {item.traceId ? <Link href={{ pathname: '/trace/[id]', params: { id: item.traceId } }}><ThemedText color="accent">Open trace</ThemedText></Link> : null}
      </Card>} />
    {editing ? <EditViewForm initial={spec} onClose={() => setEditing(false)} onApply={(next) => { setDraft(next); setEditing(false); setNotice(''); }} /> : null}
    {saveMode ? <SaveViewForm source={view.source} initial={spec} id={saveMode === 'update' ? view.id : undefined}
      onClose={() => setSaveMode(undefined)} onSaved={(id, savedSpec) => {
        setSaveMode(undefined);
        setDraft(savedSpec);
        setNotice('Saved to SigNoz.');
        if (id !== view.id) router.push({ pathname: '/views/[id]', params: { id, ...viewRangeParams(range) } });
      }} /> : null}
  </>;
}
