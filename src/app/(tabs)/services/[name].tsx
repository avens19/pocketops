import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { LineChart } from '@/components/line-chart';
import { ErrorState, Loading } from '@/components/query-state';
import { RangePicker } from '@/components/range-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { formatCount, formatDuration, formatPercent, formatTime } from '@/lib/format';
import { fetchErrorSpans, fetchServiceSeries, fetchTopOperations } from '@/lib/signoz/api';
import { RANGES, rangeFor, stepSeconds, type RangeKey } from '@/lib/signoz/queries';
import type { Series } from '@/lib/signoz/types';

type Panel = 'requests' | 'latency' | 'errors';

export default function ServiceDetailScreen() {
  const { name, range: rangeParam } = useLocalSearchParams<{ name: string; range?: string }>();
  const client = useClient();
  const [rangeKey, setRangeKey] = useState<RangeKey>(RANGES.some((r) => r.key === rangeParam) ? (rangeParam as RangeKey) : '1h');
  const [panel, setPanel] = useState<Panel>('requests');

  const range = useMemo(() => rangeFor(rangeKey), [rangeKey]);

  const series = useQuery({
    queryKey: ['service-series', client.endpoint, name, rangeKey],
    queryFn: ({ signal }) => fetchServiceSeries(client, rangeFor(rangeKey), name, signal),
  });
  const operations = useQuery({
    queryKey: ['service-ops', client.endpoint, name, rangeKey],
    queryFn: ({ signal }) => fetchTopOperations(client, rangeFor(rangeKey), name, signal),
  });
  const errors = useQuery({
    queryKey: ['service-errors', client.endpoint, name, rangeKey],
    queryFn: ({ signal }) => fetchErrorSpans(client, rangeFor(rangeKey), name, signal),
  });

  const refreshing = series.isRefetching || operations.isRefetching || errors.isRefetching;
  const refresh = () => {
    series.refetch();
    operations.refetch();
    errors.refetch();
  };

  const chartSeries = useMemo(() => derive(series.data ?? [], panel, stepSeconds(range)), [series.data, panel, range]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: name }} />

      <RangePicker value={rangeKey} onChange={setRangeKey} />

      <Card>
        <View style={styles.chips}>
          <Chip label="Requests/s" selected={panel === 'requests'} onPress={() => setPanel('requests')} />
          <Chip label="p99 latency" selected={panel === 'latency'} onPress={() => setPanel('latency')} />
          <Chip label="Error rate" selected={panel === 'errors'} onPress={() => setPanel('errors')} />
        </View>
        {series.isPending ? (
          <Loading />
        ) : series.isError ? (
          <ErrorState error={series.error} onRetry={() => series.refetch()} />
        ) : (
          <LineChart
            series={chartSeries}
            format={panel === 'latency' ? formatDuration : panel === 'errors' ? formatPercent : undefined}
          />
        )}
      </Card>

      <Link href={{ pathname: '/logs', params: { service: name } }} asChild>
        <Pressable accessibilityRole="link">
          <ThemedText color="accent" style={styles.bold}>
            View logs for this service ›
          </ThemedText>
        </Pressable>
      </Link>

      <View style={styles.section}>
        <ThemedText type="caption" style={styles.sectionTitle}>
          TOP OPERATIONS
        </ThemedText>
        {operations.isPending ? (
          <Loading />
        ) : operations.isError ? (
          <ErrorState error={operations.error} onRetry={() => operations.refetch()} />
        ) : (
          <Card style={styles.table}>
            {(operations.data ?? []).map((op) => (
              <View key={op.name} style={styles.opRow}>
                <ThemedText type="small" numberOfLines={1} style={styles.flex}>
                  {op.name}
                </ThemedText>
                <ThemedText type="caption" style={styles.num}>
                  {formatCount(op.calls)}
                </ThemedText>
                <ThemedText type="caption" style={styles.num}>
                  {formatDuration(op.p99Ms)}
                </ThemedText>
                <ThemedText
                  type="caption"
                  color={op.calls > 0 && op.errors / op.calls >= 0.05 ? 'danger' : 'textSecondary'}
                  style={styles.num}>
                  {formatPercent(op.calls > 0 ? op.errors / op.calls : 0)}
                </ThemedText>
              </View>
            ))}
            {(operations.data ?? []).length === 0 ? (
              <ThemedText type="small" color="textSecondary">
                No operations in this range.
              </ThemedText>
            ) : null}
          </Card>
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="caption" style={styles.sectionTitle}>
          RECENT ERRORS
        </ThemedText>
        {errors.isPending ? (
          <Loading />
        ) : errors.isError ? (
          <ErrorState error={errors.error} onRetry={() => errors.refetch()} />
        ) : (errors.data ?? []).length === 0 ? (
          <ThemedText type="small" color="textSecondary">
            No error spans in this range.
          </ThemedText>
        ) : (
          (errors.data ?? []).map((e, i) => (
            <Card key={`${e.traceId}-${i}`}>
              <ThemedText type="small" style={styles.bold}>
                {e.name}
              </ThemedText>
              {e.message ? (
                <ThemedText type="small" color="danger" numberOfLines={3}>
                  {e.message}
                </ThemedText>
              ) : null}
              <ThemedText type="caption">
                {formatTime(e.timestamp)} · {formatDuration(e.durationMs)}
              </ThemedText>
            </Card>
          ))
        )}
      </View>
    </ScrollView>
  );
}

/** Turns the calls/errors/p99 series into the one the selected panel plots. */
function derive(series: Series[], panel: Panel, step: number): Series[] {
  const byName = (n: string) => series.find((s) => s.name === n);
  const calls = byName('calls');
  if (panel === 'requests') {
    return calls ? [{ ...calls, points: calls.points.map((p) => ({ t: p.t, v: p.v / step })) }] : [];
  }
  if (panel === 'latency') {
    const p99 = byName('p99');
    return p99 ? [{ ...p99, points: p99.points.map((p) => ({ t: p.t, v: p.v / 1e6 })) }] : [];
  }
  const errors = byName('errors');
  if (!calls || !errors) return [];
  const callAt = new Map(calls.points.map((p) => [p.t, p.v]));
  return [
    {
      ...errors,
      points: errors.points.map((p) => ({ t: p.t, v: (callAt.get(p.t) ?? 0) > 0 ? p.v / callAt.get(p.t)! : 0 })),
    },
  ];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  chips: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  bold: { fontWeight: '600' },
  section: { gap: Spacing.two },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6 },
  table: { gap: Spacing.two },
  opRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  num: { width: 56, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
