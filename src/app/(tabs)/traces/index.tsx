import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { FilterBar } from '@/components/filter-bar';
import { GroupByEditor } from '@/components/filter-editor';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { RangeChip } from '@/components/range-chip';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebounced } from '@/hooks/use-debounced';
import { useTheme } from '@/hooks/use-theme';
import { useWindowAnchor } from '@/hooks/use-window-anchor';
import { useClient } from '@/lib/auth';
import { applyRouteFilter, exploreSignature, hasExploreFilter, type ExploreParams } from '@/lib/explore-links';
import { explorer, useExplorer } from '@/lib/explorer-state';
import { clausesToExpression, inferValue } from '@/lib/filters';
import { formatCount, formatDuration } from '@/lib/format';
import { SPAN_PAGE_SIZE, fetchSpanGroups, fetchSpans, type SpanRow } from '@/lib/signoz/api';
import { quote, rangeSpecFromParams, resolveRange, type RangeSpec, type SpanSort } from '@/lib/signoz/queries';
import { serviceColor } from '@/lib/trace';

type TracesParams = ExploreParams & { groupBy?: string; op?: string };

export default function TracesScreen() {
  const params = useLocalSearchParams<TracesParams>();
  return <TracesView key={`${params.last}|${params.from}|${params.to}`} params={params} />;
}

/** Spans matching a filter, one row per trace by default. Tap a row for the waterfall; tap attributes there to refine. */
function TracesView({ params }: { params: TracesParams }) {
  const client = useClient();
  const theme = useTheme();
  const [range, setRange] = useState<RangeSpec>(() => rangeSpecFromParams(params) ?? { key: '1h' });
  const { clauses, text, sig, rootOnly, errorsOnly, groupBy } = useExplorer('traces');
  const [groupOpen, setGroupOpen] = useState(false);
  const [sort, setSort] = useState<SpanSort>('latest');

  const routeSig = exploreSignature(params);
  const landed = !hasExploreFilter(params) || sig === routeSig;
  useEffect(() => {
    applyRouteFilter('traces', params);
  }, [params, routeSig]);

  const searchText = useDebounced(text.trim(), 400);
  const filterExpression = clausesToExpression(clauses);
  const expression = [
    rootOnly ? 'isRoot = true' : '',
    errorsOnly ? 'has_error = true' : '',
    filterExpression ? `(${filterExpression})` : '',
    searchText ? `name CONTAINS ${quote(searchText)}` : '',
  ]
    .filter(Boolean)
    .join(' AND ');

  const [anchor, refresh] = useWindowAnchor(JSON.stringify([range, expression, sort]));
  const resolved = resolveRange(range, anchor);

  const spans = useInfiniteQuery({
    queryKey: ['spans', client.endpoint, expression, sort, range, anchor],
    enabled: landed && groupBy.length === 0,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchSpans(client, resolved, expression, pageParam, sort, signal),
    getNextPageParam: (last, all) => (last.length === SPAN_PAGE_SIZE ? all.length * SPAN_PAGE_SIZE : undefined),
    gcTime: 60_000,
  });
  const groups = useQuery({
    queryKey: ['span-groups', client.endpoint, expression, groupBy, range, anchor],
    queryFn: ({ signal }) => fetchSpanGroups(client, resolved, expression, groupBy, signal),
    enabled: landed && groupBy.length > 0,
  });

  const rows = useMemo(() => spans.data?.pages.flat() ?? [], [spans.data]);

  /** Tapping a group shows its spans: one clause per grouping field, skipping empty values. */
  function drillInto(labels: string[]) {
    groupBy.forEach((key, i) => {
      if (labels[i]) explorer.investigate('traces', { kind: 'filter', key, op: '=', value: inferValue(labels[i]) });
    });
    explorer.setGroupBy('traces', []);
  }

  const header = (
    <View style={styles.header}>
      <SearchField value={text} onChangeText={(t) => explorer.setText('traces', t)} placeholder="Search span names" />
      <FilterBar signal="traces" range={resolved} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <RangeChip value={range} onChange={(key) => setRange({ key })} />
        <Chip
          label={groupBy.length > 0 ? `Group: ${groupBy.join(', ')}  ✕` : 'Group by'}
          selected={groupBy.length > 0}
          onPress={() => (groupBy.length > 0 ? explorer.setGroupBy('traces', []) : setGroupOpen(true))}
        />
        <Chip label="Errors" selected={errorsOnly} onPress={() => explorer.setErrorsOnly('traces', !errorsOnly)} />
        <Chip label="Slowest" selected={sort === 'slowest'} onPress={() => setSort((s) => (s === 'slowest' ? 'latest' : 'slowest'))} />
        <Chip label="Root spans" selected={rootOnly} onPress={() => explorer.setRootOnly('traces', !rootOnly)} />
      </ScrollView>
      {params.op ? (
        <ThemedText type="small" color="textSecondary">
          This link uses a trace operator (for example “B → A”), which PocketOps can’t run. Showing the spans for the first query only.
        </ThemedText>
      ) : null}
      {groupBy.length > 0 ? (
        <View style={styles.groups}>
          <View style={styles.groupHead}>
            <ThemedText type="caption" style={[styles.bold, styles.flex]}>
              {groupBy.join(' · ').toUpperCase()}
            </ThemedText>
            <ThemedText type="caption" style={[styles.bold, styles.num]}>
              SPANS
            </ThemedText>
            <ThemedText type="caption" style={[styles.bold, styles.num]}>
              ERR
            </ThemedText>
            <ThemedText type="caption" style={[styles.bold, styles.num]}>
              P99
            </ThemedText>
          </View>
          {groups.isPending ? (
            <Loading />
          ) : groups.isError ? (
            <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
          ) : (groups.data ?? []).length === 0 ? (
            <Empty title="No spans found" hint="Try a wider time range or fewer filters." />
          ) : (
            <Card style={styles.table}>
              {(groups.data ?? []).map((g, i) => (
                <Pressable
                  key={`${g.labels.join('|')}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${g.labels.join(' ')}: ${g.count} spans, ${g.errors} errors. Show them`}
                  onPress={() => drillInto(g.labels)}
                  style={styles.groupRow}>
                  <ThemedText type="small" numberOfLines={2} style={styles.flex}>
                    {g.labels.map((l) => l || '(none)').join(' · ')}
                  </ThemedText>
                  <ThemedText type="small" style={styles.num}>
                    {formatCount(g.count)}
                  </ThemedText>
                  <ThemedText type="small" color={g.errors > 0 ? 'danger' : 'textSecondary'} style={styles.num}>
                    {formatCount(g.errors)}
                  </ThemedText>
                  <ThemedText type="small" style={styles.num}>
                    {formatDuration(g.p99Ms)}
                  </ThemedText>
                </Pressable>
              ))}
            </Card>
          )}
        </View>
      ) : null}
    </View>
  );

  let body: React.ReactNode = null;
  if (groupBy.length > 0) body = null;
  else if (!landed || spans.isPending) body = <Loading />;
  else if (spans.isError && rows.length === 0) body = <ErrorState error={spans.error} onRetry={() => spans.refetch()} />;
  else if (rows.length === 0) body = <Empty title="No spans found" hint="Try a wider time range or fewer filters." />;

  return (
    <>
      <FlatList
        data={body || groupBy.length > 0 ? [] : rows}
        keyExtractor={(r, i) => `${r.spanId || r.traceId}-${i}`}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={spans.isRefetching && !spans.isFetchingNextPage} onRefresh={refresh} />}
        ListHeaderComponent={
          <>
            {header}
            {body}
          </>
        }
        ListFooterComponent={spans.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : undefined}
        onEndReachedThreshold={0.5}
        onEndReached={() => spans.hasNextPage && !spans.isFetchingNextPage && spans.fetchNextPage()}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
        renderItem={({ item }) => <SpanLine row={item} />}
      />
      <GroupByEditor
        visible={groupOpen}
        signal="traces"
        range={resolved}
        onClose={() => setGroupOpen(false)}
        onSubmit={(keys) => {
          explorer.setGroupBy('traces', keys);
          setGroupOpen(false);
        }}
      />
    </>
  );
}

function SpanLine({ row }: { row: SpanRow }) {
  const theme = useTheme();
  const time = new Date(row.timestamp);
  return (
    <Link href={`/trace/${encodeURIComponent(row.traceId)}`} asChild>
      <Pressable accessibilityRole="button" style={styles.line}>
        <View style={[styles.bar, { backgroundColor: row.hasError ? theme.danger : serviceColor(row.service) }]} />
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <ThemedText type="small" numberOfLines={1} style={[styles.flex, styles.bold]}>
              {row.name}
            </ThemedText>
            <ThemedText type="small" style={styles.duration}>
              {formatDuration(row.durationMs)}
            </ThemedText>
          </View>
          {row.message ? (
            <ThemedText type="small" color="danger" numberOfLines={2}>
              {row.message}
            </ThemedText>
          ) : null}
          <ThemedText type="caption">
            {[row.service, Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '600' },
  list: { paddingBottom: Spacing.four },
  header: { padding: Spacing.three, gap: Spacing.two },
  chips: { gap: Spacing.two },
  groups: { gap: Spacing.two, marginTop: Spacing.one },
  table: { gap: Spacing.two },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 6 },
  num: { minWidth: 52, textAlign: 'right', fontVariant: ['tabular-nums'] },
  footer: { padding: Spacing.three },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  line: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 2 },
  bar: { width: 3, borderRadius: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  duration: { fontVariant: ['tabular-nums'] },
});
