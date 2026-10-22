import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { LineChart } from '@/components/line-chart';
import { ErrorState, Loading } from '@/components/query-state';
import { RangePicker } from '@/components/range-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { fetchMetricSeries, listMetrics } from '@/lib/signoz/api';
import { rangeFor, type RangeKey } from '@/lib/signoz/queries';

const GROUPS = ['service.name', 'host.name', 'k8s.pod.name'];

export default function MetricDetailScreen() {
  const params = useLocalSearchParams<{ name: string; type?: string; monotonic?: string; unit?: string }>();
  const client = useClient();
  const [rangeKey, setRangeKey] = useState<RangeKey>('1h');
  const [groupBy, setGroupBy] = useState<string | undefined>();

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

  const series = useQuery({
    queryKey: ['metric-series', client.endpoint, params.name, type, rangeKey, groupBy],
    enabled: !!type,
    queryFn: ({ signal }) =>
      fetchMetricSeries(client, rangeFor(rangeKey), { name: params.name, type: type!, isMonotonic: monotonic }, groupBy, signal),
  });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={series.isRefetching} onRefresh={() => void series.refetch()} />}>
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

      <RangePicker value={rangeKey} onChange={setRangeKey} />

      <View style={styles.chips}>
        <Chip label="No grouping" selected={!groupBy} onPress={() => setGroupBy(undefined)} />
        {GROUPS.map((g) => (
          <Chip key={g} label={g} selected={groupBy === g} onPress={() => setGroupBy(g)} />
        ))}
      </View>

      <Card>
        {info.isError ? (
          <ErrorState error={info.error} onRetry={() => info.refetch()} />
        ) : !type || series.isPending ? (
          <Loading />
        ) : series.isError ? (
          <ErrorState error={series.error} onRetry={() => series.refetch()} />
        ) : (
          <LineChart series={series.data ?? []} height={180} legend />
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  meta: { gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
