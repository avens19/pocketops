import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { RangePicker } from '@/components/range-picker';
import { SearchField } from '@/components/search-field';
import { severityColor } from '@/components/severity';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { LOG_PAGE_SIZE, fetchLogs } from '@/lib/signoz/api';
import {
  LOG_LEVELS,
  describeRange,
  rangeSpecFromParams,
  resolveRange,
  type LogFilter,
  type LogLevel,
  type RangeSpec,
} from '@/lib/signoz/queries';
import type { LogRow } from '@/lib/signoz/types';

type LogsParams = { service?: string; q?: string; last?: string; from?: string; to?: string };

export default function LogsScreen() {
  const params = useLocalSearchParams<LogsParams>();
  // A pasted explorer link can arrive while this screen is open; a new key restarts the view from its params.
  return <LogsView key={`${params.q}|${params.last}|${params.from}|${params.to}|${params.service}`} params={params} />;
}

function LogsView({ params }: { params: LogsParams }) {
  const client = useClient();
  const theme = useTheme();

  const [range, setRange] = useState<RangeSpec>(() => rangeSpecFromParams(params) ?? { key: '1h' });
  const [draft, setDraft] = useState(params.q ?? '');
  const [advanced, setAdvanced] = useState(!!params.q);
  const [applied, setApplied] = useState(params.q ?? '');
  const [levels, setLevels] = useState<LogLevel[]>([]);
  // The window is fixed per query so paging by offset is not disturbed by logs arriving meanwhile.
  const [anchor, setAnchor] = useState(() => Date.now());

  const filter: LogFilter = useMemo(
    () => ({
      text: advanced ? undefined : applied,
      expression: advanced ? applied : undefined,
      levels,
      service: params.service,
    }),
    [advanced, applied, levels, params.service],
  );

  const logs = useInfiniteQuery({
    queryKey: ['logs', client.endpoint, range, anchor, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchLogs(client, resolveRange(range, anchor), filter, pageParam, signal),
    getNextPageParam: (last, all) => (last.length === LOG_PAGE_SIZE ? all.length * LOG_PAGE_SIZE : undefined),
    gcTime: 60_000,
  });

  const rows = useMemo(() => logs.data?.pages.flat() ?? [], [logs.data]);
  const refresh = useCallback(() => setAnchor(Date.now()), []);
  const toggleLevel = (l: LogLevel) => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  const header = (
    <View style={styles.header}>
      <SearchField
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => {
          setApplied(draft);
          setAnchor(Date.now());
        }}
        placeholder={advanced ? "service.name = 'api' AND http.status_code >= 500" : 'Search log messages'}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={advanced ? 'Query' : 'Text'} selected onPress={() => setAdvanced((v) => !v)} />
        {LOG_LEVELS.map((l) => (
          <Chip key={l} label={l} selected={levels.includes(l)} onPress={() => toggleLevel(l)} />
        ))}
      </ScrollView>
      <RangePicker
        value={'key' in range ? range.key : null}
        onChange={(key) => {
          setRange({ key });
          setAnchor(Date.now());
        }}
      />
      {'key' in range ? null : <ThemedText type="caption">{describeRange(range)}</ThemedText>}
      {params.service ? (
        <ThemedText type="caption">Showing service: {params.service}</ThemedText>
      ) : null}
    </View>
  );

  let body: React.ReactNode = null;
  if (logs.isPending) body = <Loading />;
  else if (logs.isError && rows.length === 0) body = <ErrorState error={logs.error} onRetry={() => logs.refetch()} />;
  else if (rows.length === 0) body = <Empty title="No logs found" hint="Try a wider time range or fewer filters." />;

  return (
    <FlatList
      data={body ? [] : rows}
      keyExtractor={(r) => r.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={logs.isRefetching && !logs.isFetchingNextPage} onRefresh={refresh} />}
      ListHeaderComponent={
        <>
          {header}
          {body}
        </>
      }
      ListFooterComponent={logs.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : undefined}
      onEndReachedThreshold={0.5}
      onEndReached={() => logs.hasNextPage && !logs.isFetchingNextPage && logs.fetchNextPage()}
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
            {row.body}
          </ThemedText>
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
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  line: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  bar: { width: 3, borderRadius: 2 },
  meta: { flexDirection: 'row', gap: 6, marginBottom: 2 },
});
