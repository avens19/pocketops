import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { StateBadge } from '@/components/state-badge';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useRules } from '@/hooks/use-rules';
import type { AlertState, Rule } from '@/lib/signoz/types';

type Filter = 'all' | 'firing' | 'pending' | 'inactive' | 'disabled';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'firing', label: 'Firing' },
  { key: 'pending', label: 'Pending' },
  { key: 'inactive', label: 'OK' },
  { key: 'disabled', label: 'Disabled' },
];

function matches(filter: Filter, state: AlertState) {
  if (filter === 'all') return true;
  if (filter === 'pending') return state === 'pending' || state === 'recovering';
  return state === filter;
}

export default function AlertsScreen() {
  const rules = useRules();
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => (rules.data ?? []).filter((r) => matches(filter, r.state)), [rules.data, filter]);
  const firing = (rules.data ?? []).filter((r) => r.state === 'firing').length;

  if (rules.isPending) return <Loading />;
  if (rules.isError && !rules.data) return <ErrorState error={rules.error} onRetry={() => rules.refetch()} />;

  return (
    <FlatList
      data={visible}
      keyExtractor={(r) => r.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={rules.isRefetching} onRefresh={() => void rules.refetch()} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <ThemedText color={firing ? 'danger' : 'success'} style={styles.summary}>
            {firing ? `${firing} firing` : 'Nothing firing'}
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </ScrollView>
        </View>
      }
      ListEmptyComponent={<Empty title="No alert rules" hint="Nothing matches this filter." />}
      renderItem={({ item }) => <RuleRow rule={item} />}
    />
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  return (
    <Link href={`/alerts/${encodeURIComponent(rule.id)}`} asChild>
      <Pressable accessibilityRole="button">
        <Card>
          <View style={styles.rowTop}>
            <StateBadge state={rule.state} />
            {rule.severity ? (
              <ThemedText type="caption" style={styles.severity}>
                {rule.severity.toUpperCase()}
              </ThemedText>
            ) : null}
          </View>
          <ThemedText type="heading">{rule.name}</ThemedText>
          {rule.description ? (
            <ThemedText type="small" color="textSecondary" numberOfLines={2}>
              {rule.description}
            </ThemedText>
          ) : null}
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.two },
  header: { gap: Spacing.two, marginBottom: Spacing.one },
  summary: { fontSize: 15, fontWeight: '700' },
  chips: { gap: Spacing.two },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  severity: { fontWeight: '700', letterSpacing: 0.5 },
});
