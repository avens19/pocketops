import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { listMetrics } from '@/lib/signoz/api';
import { rangeFor } from '@/lib/signoz/queries';
import type { MetricInfo } from '@/lib/signoz/types';

export default function MetricsScreen() {
  const client = useClient();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');

  const metrics = useQuery({
    queryKey: ['metrics', client.endpoint, search],
    queryFn: ({ signal }) => listMetrics(client, search, rangeFor('24h'), signal),
  });

  const header = (
    <View style={styles.header}>
      <SearchField
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => setSearch(draft.trim())}
        placeholder="Search metric names"
      />
    </View>
  );

  let body: React.ReactNode = null;
  if (metrics.isPending) body = <Loading />;
  else if (metrics.isError) body = <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />;
  else if (metrics.data.length === 0) body = <Empty title="No metrics found" hint="Nothing reported in the last 24 hours matches." />;

  return (
    <FlatList
      data={body ? [] : metrics.data}
      keyExtractor={(m) => m.name}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={metrics.isRefetching} onRefresh={() => void metrics.refetch()} />}
      ListHeaderComponent={
        <>
          {header}
          {body}
        </>
      }
      renderItem={({ item }) => <MetricRow metric={item} />}
    />
  );
}

function MetricRow({ metric }: { metric: MetricInfo }) {
  return (
    <Link
      href={{
        pathname: '/metrics/[name]',
        params: { name: metric.name, type: metric.type, monotonic: metric.isMonotonic ? '1' : '0', unit: metric.unit },
      }}
      asChild>
      <Pressable accessibilityRole="button">
        <Card style={styles.row}>
          <ThemedText type="mono" numberOfLines={1}>
            {metric.name}
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
  header: { marginBottom: Spacing.two },
  row: { gap: 2, paddingVertical: Spacing.two + 2 },
});
