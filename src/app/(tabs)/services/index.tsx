import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { RangePicker } from '@/components/range-picker';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { formatCount, formatDuration, formatPercent } from '@/lib/format';
import { fetchServices } from '@/lib/signoz/api';
import { rangeFor, type RangeKey } from '@/lib/signoz/queries';
import type { ServiceStat } from '@/lib/signoz/types';

type Sort = 'requests' | 'errors' | 'p99';

const SORTS: { key: Sort; label: string; compare: (a: ServiceStat, b: ServiceStat) => number }[] = [
  { key: 'requests', label: 'Requests', compare: (a, b) => b.calls - a.calls },
  { key: 'errors', label: 'Errors', compare: (a, b) => errorRate(b) - errorRate(a) || b.errors - a.errors },
  { key: 'p99', label: 'p99', compare: (a, b) => b.p99Ms - a.p99Ms },
];

const errorRate = (s: ServiceStat) => (s.calls > 0 ? s.errors / s.calls : 0);

export default function ServicesScreen() {
  const client = useClient();
  const [rangeKey, setRangeKey] = useState<RangeKey>('1h');
  const [sort, setSort] = useState<Sort>('requests');
  const [search, setSearch] = useState('');

  const services = useQuery({
    queryKey: ['services', client.endpoint, rangeKey],
    queryFn: ({ signal }) => fetchServices(client, rangeFor(rangeKey), signal),
    refetchInterval: 60_000,
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const compare = SORTS.find((x) => x.key === sort)!.compare;
    return (services.data ?? []).filter((x) => !needle || x.name.toLowerCase().includes(needle)).sort(compare);
  }, [services.data, sort, search]);

  const header = (
    <View style={styles.header}>
      {(services.data ?? []).length > 6 ? <SearchField value={search} onChangeText={setSearch} placeholder="Find a service" /> : null}
      <RangePicker value={rangeKey} onChange={setRangeKey} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sorts}>
        <ThemedText type="caption" style={styles.sortLabel}>
          Sort by
        </ThemedText>
        {SORTS.map((x) => (
          <Chip key={x.key} label={x.label} selected={sort === x.key} onPress={() => setSort(x.key)} />
        ))}
      </ScrollView>
    </View>
  );

  if (services.isPending) return <Loading />;
  if (services.isError && !services.data) return <ErrorState error={services.error} onRetry={() => services.refetch()} />;

  return (
    <FlatList
      data={visible}
      keyExtractor={(s) => s.name}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={services.isRefetching} onRefresh={() => void services.refetch()} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        search.trim() ? (
          <Empty title="No matching service" hint={`Nothing named “${search.trim()}” reported in this range.`} />
        ) : (
          <Empty title="No services reporting" hint="No spans were received in this time range." />
        )
      }
      renderItem={({ item }) => <ServiceRow service={item} rangeKey={rangeKey} />}
    />
  );
}

function ServiceRow({ service, rangeKey }: { service: ServiceStat; rangeKey: RangeKey }) {
  const theme = useTheme();
  const rate = errorRate(service);
  // Health at a glance: red from 5% errors, amber from 1%, otherwise green.
  const health = rate >= 0.05 ? theme.danger : rate >= 0.01 ? theme.warning : theme.success;
  return (
    <Link href={`/services/${encodeURIComponent(service.name)}?range=${rangeKey}`} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`${service.name}, ${formatPercent(rate)} errors, p99 ${formatDuration(service.p99Ms)}`}>
        <Card style={styles.card}>
          <View style={[styles.health, { backgroundColor: health }]} />
          <ThemedText type="heading">{service.name}</ThemedText>
          <View style={styles.stats}>
            <Stat label="p99" value={formatDuration(service.p99Ms)} />
            <Stat label="Requests" value={formatCount(service.calls)} />
            <Stat label="Errors" value={`${formatPercent(rate)}${service.errors > 0 ? ` · ${formatCount(service.errors)}` : ''}`} danger={rate >= 0.05} />
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
  header: { marginBottom: Spacing.one, gap: Spacing.two },
  sorts: { gap: Spacing.two, alignItems: 'center' },
  sortLabel: { marginRight: 2 },
  card: { overflow: 'hidden', paddingLeft: Spacing.three + 4 },
  health: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  stats: { flexDirection: 'row', gap: Spacing.four },
  stat: { gap: 1 },
  statValue: { fontWeight: '600', fontVariant: ['tabular-nums'] },
});
