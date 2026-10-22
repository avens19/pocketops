import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { RangePicker } from '@/components/range-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { formatCount, formatDuration, formatPercent } from '@/lib/format';
import { fetchServices } from '@/lib/signoz/api';
import { rangeFor, type RangeKey } from '@/lib/signoz/queries';
import type { ServiceStat } from '@/lib/signoz/types';

export default function ServicesScreen() {
  const client = useClient();
  const [rangeKey, setRangeKey] = useState<RangeKey>('1h');

  const services = useQuery({
    queryKey: ['services', client.endpoint, rangeKey],
    queryFn: ({ signal }) => fetchServices(client, rangeFor(rangeKey), signal),
    refetchInterval: 60_000,
  });

  const header = (
    <View style={styles.header}>
      <RangePicker value={rangeKey} onChange={setRangeKey} />
    </View>
  );

  if (services.isPending) return <Loading />;
  if (services.isError && !services.data) return <ErrorState error={services.error} onRetry={() => services.refetch()} />;

  return (
    <FlatList
      data={services.data}
      keyExtractor={(s) => s.name}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={services.isRefetching} onRefresh={() => void services.refetch()} />}
      ListHeaderComponent={header}
      ListEmptyComponent={<Empty title="No services reporting" hint="No spans were received in this time range." />}
      renderItem={({ item }) => <ServiceRow service={item} rangeKey={rangeKey} />}
    />
  );
}

function ServiceRow({ service, rangeKey }: { service: ServiceStat; rangeKey: RangeKey }) {
  const errorRate = service.calls > 0 ? service.errors / service.calls : 0;
  return (
    <Link href={`/services/${encodeURIComponent(service.name)}?range=${rangeKey}`} asChild>
      <Pressable accessibilityRole="button">
        <Card>
          <ThemedText type="heading">{service.name}</ThemedText>
          <View style={styles.stats}>
            <Stat label="p99" value={formatDuration(service.p99Ms)} />
            <Stat label="Requests" value={formatCount(service.calls)} />
            <Stat label="Errors" value={formatPercent(errorRate)} danger={errorRate >= 0.05} />
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="caption">{label}</ThemedText>
      <ThemedText color={danger ? 'danger' : 'text'} style={styles.statValue}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.two },
  header: { marginBottom: Spacing.one },
  stats: { flexDirection: 'row', gap: Spacing.four },
  stat: { gap: 1 },
  statValue: { fontWeight: '600', fontVariant: ['tabular-nums'] },
});
