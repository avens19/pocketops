import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebounced } from '@/hooks/use-debounced';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { browse, membersUnder, searchMetrics, type MetricEntry } from '@/lib/metric-tree';
import { listMetrics, METRIC_LIMIT } from '@/lib/signoz/api';
import { rangeFor } from '@/lib/signoz/queries';
import type { MetricInfo } from '@/lib/signoz/types';

/** Metrics browse like folders: this screen is pushed again for each group, with `prefix` set to where it opened. */
export default function MetricsScreen() {
  const client = useClient();
  const theme = useTheme();
  const { prefix: requested = '' } = useLocalSearchParams<{ prefix?: string }>();
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 150);

  const metrics = useQuery({
    queryKey: ['metrics', client.endpoint],
    queryFn: ({ signal }) => listMetrics(client, '', rangeFor('24h'), signal),
    staleTime: 5 * 60_000,
  });

  const level = useMemo(() => (metrics.data ? browse(metrics.data, requested) : null), [metrics.data, requested]);
  const prefix = level?.prefix ?? requested;
  const found = useMemo(
    () => (metrics.data && search ? searchMetrics(membersUnder(metrics.data, prefix), search) : null),
    [metrics.data, prefix, search],
  );

  let status: React.ReactNode = null;
  if (metrics.isPending) status = <Loading />;
  else if (metrics.isError) status = <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />;
  else if (metrics.data.length === 0) status = <Empty title="No metrics found" hint="Nothing reported in the last 24 hours." />;
  else if (found && found.length === 0) status = <Empty title="No matches" hint={`No metric name contains “${search}”.`} />;

  const entries: MetricEntry<MetricInfo>[] = status
    ? []
    : found
      ? found.map((metric) => ({ kind: 'metric' as const, metric, label: metric.name }))
      : (level?.entries ?? []);

  const count = found ? found.length : (level?.total ?? 0);
  const caption = !metrics.data
    ? null
    : `${count} ${count === 1 ? 'metric' : 'metrics'}${found ? ' match' : ''}${prefix ? ` in ${prefix}` : ''}${metrics.data.length >= METRIC_LIMIT ? ` · showing the first ${METRIC_LIMIT}` : ''}`;

  return (
    <>
      {prefix || requested ? <Stack.Screen options={{ title: prefix || requested, headerLargeTitleEnabled: false }} /> : null}
      <FlatList
        data={entries}
        keyExtractor={(e) => (e.kind === 'group' ? `g:${e.prefix}` : `m:${e.metric.name}`)}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={metrics.isRefetching} onRefresh={() => void metrics.refetch()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder={prefix ? `Search within ${prefix}` : 'Search metric names'}
              accessibilityLabel="Search metric names"
            />
            {caption ? <ThemedText type="caption" style={{ color: theme.textSecondary }}>{caption}</ThemedText> : null}
            {status}
          </View>
        }
        renderItem={({ item }) => (item.kind === 'group' ? <GroupRow entry={item} /> : <MetricRow metric={item.metric} label={item.label} />)}
      />
    </>
  );
}

function GroupRow({ entry }: { entry: Extract<MetricEntry<MetricInfo>, { kind: 'group' }> }) {
  const theme = useTheme();
  return (
    <Link href={{ pathname: '/metrics', params: { prefix: entry.prefix } }} push asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`${entry.label}, ${entry.count} metrics`}>
        <Card style={styles.groupRow}>
          <View style={styles.groupText}>
            <ThemedText type="mono" numberOfLines={1}>
              {entry.label}
            </ThemedText>
            <ThemedText type="caption">{entry.count} metrics</ThemedText>
          </View>
          <Icon name="chevronRight" size={22} color={theme.textSecondary} />
        </Card>
      </Pressable>
    </Link>
  );
}

function MetricRow({ metric, label }: { metric: MetricInfo; label: string }) {
  return (
    <Link
      href={{
        pathname: '/metrics/[name]',
        params: { name: metric.name, type: metric.type, monotonic: metric.isMonotonic ? '1' : '0', unit: metric.unit },
      }}
      asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={metric.name}>
        <Card style={styles.row}>
          <ThemedText type="mono" numberOfLines={1}>
            {label}
          </ThemedText>
          <ThemedText type="caption">
            {metric.type}
            {metric.unit ? ` · ${metric.unit}` : ''}
          </ThemedText>
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.two },
  header: { gap: Spacing.two, marginBottom: Spacing.one },
  row: { gap: 2, paddingVertical: Spacing.two + 2 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + 2 },
  groupText: { flex: 1, gap: 2 },
});
