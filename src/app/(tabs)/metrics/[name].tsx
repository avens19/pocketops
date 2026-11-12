import { SavedViewsBar } from '@/components/saved-views';
import { viewSpecFromQuery } from '@/lib/signoz/views';
import { metricSeriesQuery } from '@/lib/signoz/queries';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { LineChart } from '@/components/line-chart';
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

  const [anchor, refresh] = useWindowAnchor(JSON.stringify([range, groupBy, activeAggregation?.key]));
  const resolved = resolveRange(range, anchor);
  const series = useQuery({
    queryKey: ['metric-series', client.endpoint, params.name, type, resolved, groupBy, activeAggregation?.key],
    enabled: !!type,
    queryFn: ({ signal }) =>
      fetchMetricSeries(client, resolved, { name: params.name, type: type!, isMonotonic: monotonic }, { groupBy, aggregation: activeAggregation?.key }, signal),
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

      <SavedViewsBar source="metrics" range={range} spec={type ? viewSpecFromQuery('metrics', metricSeriesQuery(resolved, params.name, type, { monotonic, groupBy, aggregation: activeAggregation?.key })) : undefined} />
      <RangeChip value={range} onChange={(key) => setRange({ key })} />

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
          <LineChart series={series.data ?? []} height={180} legend format={format} />
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  meta: { gap: 2 },
  row: { gap: 4 },
  rowLabel: { fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
