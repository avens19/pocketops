import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AttributeList } from '@/components/attribute-list';
import { Chip } from '@/components/chip';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { explorer } from '@/lib/explorer-state';
import { formatDuration, formatTime } from '@/lib/format';
import { fetchTrace } from '@/lib/signoz/api';
import { barGeometry, descendantCounts, firstErrorSpan, serviceColor, visibleSpans, type TraceDetail, type TraceSpan } from '@/lib/trace';

const INDENT = 14;
const MAX_INDENT_LEVELS = 8;

/** One trace as a waterfall: every span on a shared timeline, indented by depth, with details one tap away. */
export default function TraceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useClient();
  const trace = useQuery({
    queryKey: ['trace', client.endpoint, id],
    queryFn: ({ signal }) => fetchTrace(client, id, signal),
  });

  if (trace.isPending) return <Loading />;
  if (trace.isError) return <ErrorState error={trace.error} onRetry={() => trace.refetch()} />;
  if (trace.data.spans.length === 0) {
    return <Empty title="Trace not found" hint="It may be older than the retention period, or still being ingested. Try again in a moment." />;
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Trace' }} />
      <Waterfall trace={trace.data} />
    </>
  );
}

function Waterfall({ trace }: { trace: TraceDetail }) {
  const router = useRouter();
  const theme = useTheme();
  const list = useRef<FlatList<TraceSpan>>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => descendantCounts(trace.spans), [trace.spans]);
  const shown = useMemo(() => visibleSpans(trace.spans, collapsed), [trace.spans, collapsed]);
  const failure = useMemo(() => firstErrorSpan(trace.spans), [trace.spans]);

  function toggleCollapsed(id: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function jumpToFailure() {
    if (!failure) return;
    // Reveal it first: it may sit inside a collapsed subtree.
    setCollapsed(new Set());
    setOpenId(failure.id);
    const index = visibleSpans(trace.spans, new Set()).findIndex((s) => s.id === failure.id);
    setTimeout(() => list.current?.scrollToIndex({ index: Math.max(index, 0), animated: true, viewPosition: 0.2 }), 50);
  }

  const total = trace.endMs - trace.startMs;

  const header = (
    <View style={styles.header}>
      <ThemedText type="heading" selectable>
        {trace.rootName || '(unnamed trace)'}
      </ThemedText>
      <View style={styles.stats}>
        <Stat label="Duration" value={formatDuration(total)} />
        <Stat label="Spans" value={String(trace.totalSpans)} />
        <Stat label="Errors" value={String(trace.errorSpans)} danger={trace.errorSpans > 0} />
        <Stat label="Services" value={String(new Set(trace.spans.map((s) => s.service)).size)} />
      </View>
      <ThemedText type="caption">
        {trace.rootService} · {formatTime(trace.startMs)}
      </ThemedText>
      <View style={styles.actions}>
        <Chip
          label="Logs for this trace"
          onPress={() => {
            explorer.setExpression('logs', `trace_id = '${trace.traceId}'`);
            router.navigate('/logs');
          }}
        />
        {failure ? <Chip label="Jump to failure" onPress={jumpToFailure} /> : null}
        {collapsed.size > 0 ? <Chip label="Expand all" onPress={() => setCollapsed(new Set())} /> : null}
      </View>
      {failure ? (
        <Pressable onPress={jumpToFailure} style={[styles.banner, { backgroundColor: theme.danger + '1F', borderColor: theme.danger }]} accessibilityRole="button">
          <ThemedText type="small" color="danger" style={styles.bold}>
            Failed in {failure.service}
          </ThemedText>
          <ThemedText type="small" color="danger" numberOfLines={2}>
            {failure.name}
            {failure.statusMessage ? ` — ${failure.statusMessage}` : ''}
          </ThemedText>
        </Pressable>
      ) : null}
      {trace.truncated || trace.hasMissingSpans ? (
        <ThemedText type="caption" color="warning">
          {trace.truncated ? 'This trace is large; only part of it is shown. ' : ''}
          {trace.hasMissingSpans ? 'Some spans never arrived, so parts of the tree may be detached.' : ''}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <FlatList
      ref={list}
      data={shown}
      keyExtractor={(s) => s.id}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      onScrollToIndexFailed={(info) => {
        // The row has not been measured yet (it is far off screen): jump near it by the average row height, then retry.
        list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.2 }), 120);
      }}
      ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
      renderItem={({ item }) => (
        <SpanRow
          span={item}
          trace={trace}
          open={openId === item.id}
          collapsed={collapsed.has(item.id)}
          hiddenCount={counts.get(item.id) ?? 0}
          onToggleOpen={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
          onToggleCollapsed={() => toggleCollapsed(item.id)}
        />
      )}
    />
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="caption">{label}</ThemedText>
      <ThemedText type="heading" color={danger ? 'danger' : 'text'}>
        {value}
      </ThemedText>
    </View>
  );
}

interface SpanRowProps {
  span: TraceSpan;
  trace: TraceDetail;
  open: boolean;
  collapsed: boolean;
  hiddenCount: number;
  onToggleOpen: () => void;
  onToggleCollapsed: () => void;
}

function SpanRow({ span, trace, open, collapsed, hiddenCount, onToggleOpen, onToggleCollapsed }: SpanRowProps) {
  const theme = useTheme();
  const { left, width } = barGeometry(span, trace);
  const color = span.hasError ? theme.danger : serviceColor(span.service);
  const indent = Math.min(span.level, MAX_INDENT_LEVELS) * INDENT;

  return (
    <View style={open ? { backgroundColor: theme.card } : undefined}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${span.service} ${span.name}, ${formatDuration(span.durationMs)}`} accessibilityState={{ expanded: open }} onPress={onToggleOpen} style={styles.row}>
        <View style={[styles.titleLine, { paddingLeft: indent }]}>
          {span.hasChildren ? (
            <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand children' : 'Collapse children'} hitSlop={10} onPress={onToggleCollapsed} style={styles.chevron}>
              <ThemedText type="caption">{collapsed ? '▸' : '▾'}</ThemedText>
            </Pressable>
          ) : (
            <View style={styles.chevron} />
          )}
          <View style={[styles.dot, { backgroundColor: serviceColor(span.service) }]} />
          <ThemedText type="small" numberOfLines={1} style={[styles.name, span.hasError && { color: theme.danger }]}>
            {span.name}
          </ThemedText>
          {collapsed && hiddenCount > 0 ? (
            <ThemedText type="caption" style={styles.badge}>
              +{hiddenCount}
            </ThemedText>
          ) : null}
          <ThemedText type="caption" style={styles.duration}>
            {formatDuration(span.durationMs)}
          </ThemedText>
        </View>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.bar, { left: `${left * 100}%`, width: `${width * 100}%`, backgroundColor: color }]} />
        </View>
        <ThemedText type="caption" numberOfLines={1} style={{ paddingLeft: indent + 28 }}>
          {span.service}
          {span.kind ? ` · ${span.kind}` : ''}
        </ThemedText>
      </Pressable>
      {open ? <SpanDetail span={span} /> : null}
    </View>
  );
}

function SpanDetail({ span }: { span: TraceSpan }) {
  const router = useRouter();
  const theme = useTheme();
  const exceptions = span.events.filter((e) => e.name === 'exception' || e.isError);
  const otherEvents = span.events.filter((e) => !exceptions.includes(e));
  return (
    <View style={styles.detail}>
      {span.hasError ? (
        <View style={[styles.errorBox, { borderColor: theme.danger }]}>
          <ThemedText type="small" color="danger" style={styles.bold}>
            {span.statusMessage || 'Error'}
          </ThemedText>
        </View>
      ) : null}
      {exceptions.map((e, i) => (
        <View key={`${e.name}-${i}`} style={[styles.errorBox, { borderColor: theme.danger }]}>
          <ThemedText type="small" color="danger" style={styles.bold}>
            {e.attributes['exception.type'] ?? e.name}
            {e.attributes['exception.message'] ? `: ${e.attributes['exception.message']}` : ''}
          </ThemedText>
          {e.attributes['exception.stacktrace'] ? (
            <ThemedText type="mono" selectable>
              {e.attributes['exception.stacktrace']}
            </ThemedText>
          ) : null}
        </View>
      ))}
      <View style={styles.actions}>
        <Chip
          label="Logs for this span"
          onPress={() => {
            explorer.setExpression('logs', `span_id = '${span.id}'`);
            router.navigate('/logs');
          }}
        />
      </View>
      {Object.keys(span.attributes).length > 0 ? (
        <>
          <ThemedText type="caption" style={styles.bold}>
            ATTRIBUTES
          </ThemedText>
          <AttributeList values={span.attributes} primary="traces" />
        </>
      ) : null}
      {otherEvents.length > 0 ? (
        <>
          <ThemedText type="caption" style={styles.bold}>
            EVENTS
          </ThemedText>
          {otherEvents.map((e, i) => (
            <ThemedText key={`${e.name}-${i}`} type="small">
              {e.name}
            </ThemedText>
          ))}
        </>
      ) : null}
      <ThemedText type="caption" style={styles.bold}>
        RESOURCE
      </ThemedText>
      <AttributeList values={span.resources} primary="traces" />
      <ThemedText type="caption" selectable>
        span {span.id}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: Spacing.five },
  header: { padding: Spacing.three, gap: Spacing.two },
  stats: { flexDirection: 'row', gap: Spacing.four },
  stat: { gap: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  banner: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three - 4, gap: 2 },
  bold: { fontWeight: '600' },
  separator: { height: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 2, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chevron: { width: 18, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, fontWeight: '600' },
  badge: { fontWeight: '700' },
  duration: { fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { position: 'absolute', top: 0, bottom: 0, borderRadius: 4, minWidth: 3 },
  detail: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  errorBox: { borderWidth: 1, borderRadius: Radius.small, padding: Spacing.two, gap: 4 },
});
