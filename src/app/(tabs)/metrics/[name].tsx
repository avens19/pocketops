import { SavedViewsBar } from '@/components/saved-views';
import { viewSpecFromQuery } from '@/lib/signoz/views';
import { metricSeriesQuery } from '@/lib/signoz/queries';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { FilterBar } from '@/components/filter-bar';
import { LineChart, readoutTime } from '@/components/line-chart';
import { clausesToExpression, type Clause } from '@/lib/filters';
import { useTheme } from '@/hooks/use-theme';
import type { Series } from '@/lib/signoz/types';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { RangeChip } from '@/components/range-chip';
import { useWindowAnchor } from '@/hooks/use-window-anchor';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { formatUnit } from '@/lib/format';
import { fetchMetricLabels, fetchMetricSeries, listMetrics } from '@/lib/signoz/api';
import { metricAggregations, rangeFor, type MetricGroup, rangeSpecFromParams, resolveRange, type RangeSpec } from '@/lib/signoz/queries';

export default function MetricDetailScreen() {
  const params = useLocalSearchParams<{ name: string; type?: string; monotonic?: string; unit?: string; from?: string; to?: string; last?: string }>();
  const client = useClient();
  const [range, setRange] = useState<RangeSpec>(() => rangeSpecFromParams(params) ?? { key: '1h' });
  const insets = useSafeAreaInsets();
  const [groupBy, setGroupBy] = useState<MetricGroup | undefined>();
  const [aggregation, setAggregation] = useState<string | undefined>();
  const [clauses, setClauses] = useState<Clause[]>([]);
  const filter = clausesToExpression(clauses);
  // A picked time stays after the finger lifts, so the values below can be read; a refetch that drops the bucket returns to latest.
  const [picked, setPicked] = useState<number | null>(null);

  // Arriving by link carries only the name; look the type up so we know how to aggregate it.
  const info = useQuery({
    queryKey: ['metric-info', client.endpoint, params.name],
    enabled: !params.type,
    queryFn: async ({ signal }) => {
      const found = await listMetrics(client, params.name, rangeFor('24h'), signal);
      return found.find((m) => m.name === params.name);
    },
  });

  const type = params.type ?? info.data?.type;
  const monotonic = params.monotonic ? params.monotonic === '1' : info.data?.isMonotonic;
  const unit = params.unit ?? info.data?.unit;

  // The labels this metric really carries, not a fixed guess: a counter may be split by status class, a gauge by pod.
  const labels = useQuery({
    queryKey: ['metric-labels', client.endpoint, params.name],
    queryFn: ({ signal }) => fetchMetricLabels(client, params.name, rangeFor('24h'), signal),
    staleTime: 5 * 60_000,
  });

  const choices = type ? metricAggregations(type, monotonic) : [];
  const activeAggregation = choices.find((c) => c.key === aggregation) ?? choices[0];

  const [anchor, refresh] = useWindowAnchor(JSON.stringify([range, groupBy, activeAggregation?.key, filter]));
  const resolved = resolveRange(range, anchor);
  const series = useQuery({
    queryKey: ['metric-series', client.endpoint, params.name, type, resolved, groupBy, activeAggregation?.key, filter],
    enabled: !!type,
    queryFn: ({ signal }) =>
      fetchMetricSeries(client, resolved, { name: params.name, type: type!, isMonotonic: monotonic }, { groupBy, aggregation: activeAggregation?.key, filter }, signal),
  });

  // A rate is per second; everything else is in the metric's own unit.
  const format = (v: number) => formatUnit(v, unit) + (activeAggregation?.key === 'rate' ? '/s' : '');

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
      refreshControl={<RefreshControl refreshing={series.isRefetching} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: params.name }} />

      <View style={styles.meta}>
        <ThemedText type="mono" selectable>
          {params.name}
        </ThemedText>
        <ThemedText type="caption">
          {type ?? ''}
          {unit ? ` · ${unit}` : ''}
        </ThemedText>
      </View>

      <SavedViewsBar source="metrics" range={range} spec={type ? viewSpecFromQuery('metrics', metricSeriesQuery(resolved, params.name, type, { monotonic, groupBy, aggregation: activeAggregation?.key, filter })) : undefined} />
      <RangeChip value={range} onChange={(key) => setRange({ key })} />

      <FilterBar signal="metrics" range={resolved} local={{ clauses, onChange: setClauses, metric: params.name }} />

      {choices.length > 1 ? (
        <View style={styles.row}>
          <ThemedText type="caption" style={styles.rowLabel}>
            Show
          </ThemedText>
          <View style={styles.chips}>
            {choices.map((c) => (
              <Chip key={c.key} label={c.label} selected={activeAggregation?.key === c.key} onPress={() => setAggregation(c.key)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.row}>
        <ThemedText type="caption" style={styles.rowLabel}>
          Split by
        </ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Nothing" selected={!groupBy} onPress={() => setGroupBy(undefined)} />
          {(labels.data ?? []).map((g) => (
            <Chip key={g.name} label={g.name} selected={groupBy?.name === g.name} onPress={() => setGroupBy(g)} />
          ))}
        </ScrollView>
      </View>

      <Card>
        {info.isError ? (
          <ErrorState error={info.error} onRetry={() => info.refetch()} />
        ) : !type && info.isSuccess ? (
          <Empty title="Metric metadata unavailable" hint="This metric may not have reported recently. The saved view can still run its original query." />
        ) : !type || series.isPending ? (
          <Loading />
        ) : series.isError ? (
          <ErrorState error={series.error} onRetry={() => series.refetch()} />
        ) : (
          <MetricChart series={series.data ?? []} format={format} picked={picked} onPick={setPicked} />
        )}
      </Card>
    </ScrollView>
  );
}

function MetricChart({ series, format, picked, onPick }: { series: Series[]; format: (v: number) => string; picked: number | null; onPick: (t: number | null) => void }) {
  const theme = useTheme();
  const palette = [theme.accent, theme.info, theme.success, theme.warning, theme.danger];
  const at = picked !== null && series.some((s) => s.points.some((p) => p.t === picked)) ? picked : null;
  const valueAt = (points: Series['points']) => (at === null ? points.at(-1) : points.find((p) => p.t === at));
  return (
    <View style={{ gap: 10 }}>
      <LineChart series={series} height={180} format={format} cursor={at} onCursorChange={onPick} />
      {series.some((s) => s.points.length) ? (
        <View style={styles.pickRow}>
          <ThemedText type="caption" style={{ flex: 1 }}>{at === null ? 'Latest values. Touch the chart to pick a time.' : `Values at ${readoutTime(at)}`}</ThemedText>
          {at !== null ? <Chip label="Back to latest" onPress={() => onPick(null)} /> : null}
        </View>
      ) : null}
      {series.map((s, i) => {
        const p = valueAt(s.points);
        return (
          <View key={`${s.name}-${i}`} style={styles.valueRow}>
            <View style={[styles.swatch, { backgroundColor: palette[i % palette.length] }]} />
            <ThemedText type="small" style={{ flex: 1, color: palette[i % palette.length] }}>{series.length > 1 ? `${s.name}: ` : ''}{p ? format(p.v) : '—'}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 34 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  content: { padding: Spacing.three, gap: Spacing.three },
  meta: { gap: 2 },
  row: { gap: 4 },
  rowLabel: { fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
