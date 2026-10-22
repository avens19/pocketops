import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ErrorState, Loading } from '@/components/query-state';
import { RangePicker } from '@/components/range-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { formatCount, formatDuration, formatTime } from '@/lib/format';
import { fetchSpanGroups, fetchSpans } from '@/lib/signoz/api';
import { describeRange, rangeSpecFromParams, resolveRange, type RangeSpec } from '@/lib/signoz/queries';

/** Spans matching a traces-explorer query: grouped counts when the link groups by something, then the latest spans. */
export default function TracesScreen() {
  const params = useLocalSearchParams<{ q?: string; groupBy?: string; op?: string; last?: string; from?: string; to?: string }>();
  const client = useClient();
  const expression = params.q ?? '';
  const groupBy = useMemo(() => (params.groupBy ? params.groupBy.split(',').filter(Boolean) : []), [params.groupBy]);
  const [range, setRange] = useState<RangeSpec>(() => rangeSpecFromParams(params) ?? { key: '1h' });
  // Fixed per range so a pull-to-refresh is the only thing that moves the window.
  const [anchor, setAnchor] = useState(() => Date.now());
  const resolved = useMemo(() => resolveRange(range, anchor), [range, anchor]);

  const groups = useQuery({
    queryKey: ['span-groups', client.endpoint, expression, groupBy, resolved],
    queryFn: ({ signal }) => fetchSpanGroups(client, resolved, expression, groupBy, signal),
    enabled: groupBy.length > 0,
  });
  const spans = useQuery({
    queryKey: ['spans', client.endpoint, expression, resolved],
    queryFn: ({ signal }) => fetchSpans(client, resolved, expression, 50, signal),
  });

  const refreshing = spans.isRefetching || groups.isRefetching;
  const refresh = () => {
    setAnchor(Date.now());
    void spans.refetch();
    if (groupBy.length > 0) void groups.refetch();
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Card>
        <ThemedText type="caption">Query</ThemedText>
        <ThemedText type="mono" selectable>
          {expression || '(all spans)'}
        </ThemedText>
        <ThemedText type="caption">{describeRange(range)}</ThemedText>
      </Card>

      <RangePicker
        value={'key' in range ? range.key : null}
        onChange={(key) => {
          setRange({ key });
          setAnchor(Date.now());
        }}
      />

      {params.op ? (
        <ThemedText type="small" color="textSecondary">
          This link uses a trace operator (for example “B → A”), which PocketOps can’t run. Showing the spans for the first query only.
        </ThemedText>
      ) : null}

      {groupBy.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="caption" style={styles.sectionTitle}>
            COUNT BY {groupBy.join(', ').toUpperCase()}
          </ThemedText>
          {groups.isPending ? (
            <Loading />
          ) : groups.isError ? (
            <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
          ) : (groups.data ?? []).length === 0 ? (
            <ThemedText type="small" color="textSecondary">
              No spans in this range.
            </ThemedText>
          ) : (
            <Card style={styles.table}>
              {(groups.data ?? []).map((g, i) => (
                <View key={`${g.labels.join('|')}-${i}`} style={styles.row}>
                  <ThemedText type="small" numberOfLines={2} style={styles.flex}>
                    {g.labels.map((l) => l || '(none)').join(' · ')}
                  </ThemedText>
                  <ThemedText type="small" style={styles.num}>
                    {formatCount(g.count)}
                  </ThemedText>
                </View>
              ))}
            </Card>
          )}
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="caption" style={styles.sectionTitle}>
          LATEST SPANS
        </ThemedText>
        {spans.isPending ? (
          <Loading />
        ) : spans.isError ? (
          <ErrorState error={spans.error} onRetry={() => spans.refetch()} />
        ) : (spans.data ?? []).length === 0 ? (
          <ThemedText type="small" color="textSecondary">
            No spans match in this range.
          </ThemedText>
        ) : (
          (spans.data ?? []).map((s, i) => (
            <Card key={`${s.traceId}-${i}`}>
              <ThemedText type="small" style={styles.bold}>
                {s.name}
              </ThemedText>
              {s.message ? (
                <ThemedText type="small" color="danger" numberOfLines={3}>
                  {s.message}
                </ThemedText>
              ) : null}
              <ThemedText type="caption" color={s.hasError ? 'danger' : 'textSecondary'}>
                {[s.service, formatTime(s.timestamp), formatDuration(s.durationMs)].filter(Boolean).join(' · ')}
              </ThemedText>
            </Card>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  bold: { fontWeight: '600' },
  section: { gap: Spacing.two },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6 },
  table: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  num: { minWidth: 56, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
