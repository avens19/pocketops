import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { FilterBar } from '@/components/filter-bar';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { RangeChip } from '@/components/range-chip';
import { SearchField } from '@/components/search-field';
import { severityColor } from '@/components/severity';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useAppActive } from '@/hooks/use-app-active';
import { useDebounced } from '@/hooks/use-debounced';
import { useWindowAnchor } from '@/hooks/use-window-anchor';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { explorer, useExplorer } from '@/lib/explorer-state';
import { clausesToExpression } from '@/lib/filters';
import { applyRouteFilter, exploreSignature, hasExploreFilter, type ExploreParams } from '@/lib/explore-links';
import { LIVE_LOG_LIMIT, LOG_PAGE_SIZE, fetchLogs } from '@/lib/signoz/api';
import {
  LOG_LEVELS,
  rangeSpecFromParams,
  resolveRange,
  rollingRange,
  type LogFilter,
  type LogLevel,
  type RangeSpec,
} from '@/lib/signoz/queries';
import type { LogRow } from '@/lib/signoz/types';

type LogsParams = ExploreParams;


export default function LogsScreen() {
  const params = useLocalSearchParams<LogsParams>();
  // The window comes from the params too, so a new link restarts the view.
  return <LogsView key={`${params.last}|${params.from}|${params.to}`} params={params} />;
}

function LogsView({ params }: { params: LogsParams }) {
  const client = useClient();
  const theme = useTheme();

  const [range, setRange] = useState<RangeSpec>(() => rangeSpecFromParams(params) ?? { key: '1h' });
  const { clauses, text, sig } = useExplorer('logs');
  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [live, setLive] = useState(false);
  const focused = useIsFocused();
  const appActive = useAppActive();
  // Live pauses while the user has scrolled away from the top, so rows never shift under what they are reading.
  const [atTop, setAtTop] = useState(true);

  // A link, "view logs for this service/trace" or a pasted URL arrives as params and replaces the filter. Hold the
  // first request until that has landed, so it is the right one.
  const routeSig = exploreSignature(params);
  const landed = !hasExploreFilter(params) || sig === routeSig;
  useEffect(() => {
    applyRouteFilter('logs', params);
  }, [params, routeSig]);

  const expression = clausesToExpression(clauses);
  const searchText = useDebounced(text.trim(), 400);
  const filter: LogFilter = { text: searchText, expression, levels };

  // The window end is fixed per query so paging by offset is not disturbed by logs arriving meanwhile. Turning Live on or off
  // moves it, so leaving Live shows fresh rows rather than the window from before.
  const [anchor, refresh] = useWindowAnchor(JSON.stringify([range, expression, searchText, levels, live]));
  const resolved = resolveRange(range, anchor);

  const paged = useInfiniteQuery({
    queryKey: ['logs', client.endpoint, range, anchor, filter],
    enabled: landed && !live,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchLogs(client, resolved, filter, pageParam, signal),
    getNextPageParam: (last, all) => (last.length === LOG_PAGE_SIZE ? all.length * LOG_PAGE_SIZE : undefined),
    gcTime: 60_000,
  });

  // Live tail is its own query with a stable key: the newest rows, refetched on a timer. Keeping the key fixed means a refresh
  // never cancels the one before it (a slow server would otherwise starve it), a failed refresh keeps the rows on screen, and
  // there are no pages to lose. The timer only runs while this screen is showing and the app is in the foreground.
  const tail = useQuery({
    queryKey: ['logs-live', client.endpoint, expression, searchText, levels, 'key' in range ? range.key : JSON.stringify(range)],
    enabled: landed && live,
    queryFn: ({ signal }) => fetchLogs(client, rollingRange(range), filter, 0, signal, LIVE_LOG_LIMIT),
    refetchInterval: live && focused && appActive && atTop ? 3000 : false,
    gcTime: 60_000,
  });

  const source = live ? tail : paged;
  const rows = useMemo(() => (live ? (tail.data ?? []) : (paged.data?.pages.flat() ?? [])), [live, tail.data, paged.data]);
  const toggleLevel = (l: LogLevel) => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  const header = (
    <View style={styles.header}>
      <SearchField
        value={text}
        onChangeText={(t) => explorer.setText('logs', t)}
        placeholder="Search log messages"
      />
      <FilterBar signal="logs" range={resolved} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={live ? '● Live' : 'Live'} selected={live} onPress={() => setLive((v) => !v)} />
        <RangeChip value={range} onChange={(key) => setRange({ key })} />
        {LOG_LEVELS.map((l) => (
          <Chip key={l} label={l} selected={levels.includes(l)} onPress={() => toggleLevel(l)} />
        ))}
      </ScrollView>
    </View>
  );

  let body: React.ReactNode = null;
  if (!landed || source.isPending) body = <Loading />;
  else if (source.isError && rows.length === 0) body = <ErrorState error={source.error} onRetry={() => source.refetch()} />;
  else if (rows.length === 0) body = <Empty title="No logs found" hint="Try a wider time range or fewer filters." />;

  return (
    <FlatList
      data={body ? [] : rows}
      keyExtractor={(r) => r.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEventThrottle={100}
      onScroll={(e) => {
        const top = e.nativeEvent.contentOffset.y < 150;
        if (top !== atTop) setAtTop(top);
      }}
      contentContainerStyle={styles.list}
      // The spinner is for a pull-to-refresh; live polling refreshes quietly in the background.
      refreshControl={<RefreshControl refreshing={!live && paged.isRefetching && !paged.isFetchingNextPage} onRefresh={live ? () => void tail.refetch() : refresh} />}
      ListHeaderComponent={
        <>
          {header}
          {body}
        </>
      }
      ListFooterComponent={
        live ? (
          <ThemedText type="caption" style={styles.liveNote}>
            {atTop
              ? `Live: the newest ${LIVE_LOG_LIMIT} logs. Turn Live off to page further back.`
              : 'Live is paused while you scroll. Go back to the top to resume.'}
          </ThemedText>
        ) : paged.isFetchingNextPage ? (
          <ActivityIndicator style={styles.footer} />
        ) : undefined
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => !live && paged.hasNextPage && !paged.isFetchingNextPage && paged.fetchNextPage()}
      ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
      renderItem={({ item }) => <LogLine row={item} />}
    />
  );
}

function LogLine({ row }: { row: LogRow }) {
  const theme = useTheme();
  const time = new Date(row.timestamp);
  return (
    <Link href={`/logs/${encodeURIComponent(row.id)}`} asChild>
      <Pressable accessibilityRole="button" style={styles.line}>
        <View style={[styles.bar, { backgroundColor: theme[severityColor(row.severity)] }]} />
        <View style={styles.flex}>
          <View style={styles.meta}>
            <ThemedText type="caption">
              {Number.isNaN(time.getTime())
                ? ''
                : time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </ThemedText>
            {row.service ? <ThemedText type="caption">· {row.service}</ThemedText> : null}
            {row.severity ? (
              <ThemedText type="caption" style={{ color: theme[severityColor(row.severity)], fontWeight: '700' }}>
                {row.severity}
              </ThemedText>
            ) : null}
          </View>
          <ThemedText type="mono" numberOfLines={3}>
            {row.headline}
          </ThemedText>
          {row.details ? (
            <ThemedText type="caption" style={styles.details} numberOfLines={2}>
              {row.details}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: Spacing.four },
  header: { padding: Spacing.three, gap: Spacing.two },
  chips: { gap: Spacing.two },
  footer: { padding: Spacing.three },
  liveNote: { textAlign: 'center', padding: Spacing.three },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  line: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  bar: { width: 3, borderRadius: 2 },
  meta: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  details: { fontFamily: Fonts.mono, marginTop: 2 },
});
