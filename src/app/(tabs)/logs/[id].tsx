import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { AttributeList } from '@/components/attribute-list';
import { Chip } from '@/components/chip';
import { KeyValues } from '@/components/key-values';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { severityColor } from '@/components/severity';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { explorer } from '@/lib/explorer-state';
import { formatTime } from '@/lib/format';
import { logNeighbors } from '@/lib/log-neighbors';
import { fetchLogById } from '@/lib/signoz/api';

export default function LogDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useClient();
  const theme = useTheme();
  const router = useRouter();
  const [copied, setCopied] = useState<'message' | 'json' | null>(null);

  const log = useQuery({
    queryKey: ['log', client.endpoint, id],
    queryFn: ({ signal }) => fetchLogById(client, id, signal),
  });

  // Swipe sideways to step through the list the user came from: left for the next (older) log, right for the previous.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 60 && Math.abs(g.vx) < 0.5) return;
          const { previous, next } = logNeighbors(id);
          const target = g.dx < 0 ? next : previous;
          if (target) router.setParams({ id: target });
        },
      }),
    [id, router],
  );

  if (log.isPending) return <Loading />;
  if (log.isError) return <ErrorState error={log.error} onRetry={() => log.refetch()} />;
  if (!log.data) return <Empty title="Log not found" hint="It may be older than 30 days or have been dropped." />;
  const row = log.data;

  async function copy(what: 'message' | 'json') {
    const text =
      what === 'message'
        ? row.bodyPretty
        : JSON.stringify(
            {
              timestamp: row.timestamp,
              severity: row.severity,
              // A structured body goes in as the object it is, not as a string of escaped JSON.
              body: row.bodyFields ? parseJson(row.bodyPretty) : row.bodyPretty,
              service: row.service,
              trace_id: row.traceId,
              attributes: row.attributes,
              resources: row.resources,
            },
            null,
            2,
          );
    await Clipboard.setStringAsync(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  const bodyFields = row.bodyFields && Object.keys(row.bodyFields).length > 0 ? row.bodyFields : undefined;

  return (
    <View style={styles.flex} {...pan.panHandlers}>
    <ScrollView key={id} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Log' }} />

      <View style={styles.meta}>
        {row.severity ? (
          <ThemedText type="small" style={{ color: theme[severityColor(row.severity)], fontWeight: '700' }}>
            {row.severity}
          </ThemedText>
        ) : null}
        <ThemedText type="small" color="textSecondary">
          {formatTime(row.timestamp)}
        </ThemedText>
      </View>

      <Card>
        {/* A structured body leads with its message, then the whole object. */}
        {bodyFields ? (
          <ThemedText selectable style={styles.bold}>
            {row.headline}
          </ThemedText>
        ) : null}
        <ThemedText type="mono" selectable>
          {row.bodyPretty}
        </ThemedText>
        <View style={styles.copyRow}>
          <Pressable accessibilityRole="button" onPress={() => copy('message')}>
            <ThemedText type="small" color="accent" style={styles.bold}>
              {copied === 'message' ? 'Copied' : bodyFields ? 'Copy body' : 'Copy message'}
            </ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => copy('json')}>
            <ThemedText type="small" color="accent" style={styles.bold}>
              {copied === 'json' ? 'Copied' : 'Copy as JSON'}
            </ThemedText>
          </Pressable>
        </View>
      </Card>

      <View style={styles.actions}>
        {row.service ? (
          <Link href={`/services/${encodeURIComponent(row.service)}`} asChild>
            <Chip label={`Service · ${row.service}`} />
          </Link>
        ) : null}
        {row.traceId ? (
          <>
            <Link href={`/trace/${encodeURIComponent(row.traceId)}`} asChild>
              <Chip label="View trace" />
            </Link>
            <Chip
              label="Logs in this trace"
              onPress={() => {
                explorer.setExpression('logs', `trace_id = '${row.traceId}'`);
                router.navigate('/logs');
              }}
            />
          </>
        ) : null}
      </View>

      {bodyFields ? (
        <Section title="Body fields">
          {row.bodyFilterable ? (
            // Fields inside a structured body are queried as body.<key>; only logs have them, so no "show traces" action.
            <AttributeList values={Object.fromEntries(Object.entries(bodyFields).map(([k, v]) => [`body.${k}`, v]))} primary="logs" secondary={false} />
          ) : (
            <KeyValues values={bodyFields} />
          )}
        </Section>
      ) : null}
      {Object.keys(row.attributes).length > 0 ? (
        <Section title="Attributes">
          <AttributeList values={row.attributes} primary="logs" />
        </Section>
      ) : null}
      {Object.keys(row.resources).length > 0 ? (
        <Section title="Resource">
          <AttributeList values={row.resources} primary="logs" />
        </Section>
      ) : null}
      <ThemedText type="caption" style={styles.hint}>
        Tap an attribute to filter by it.
      </ThemedText>
    </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="caption" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      <Card>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  meta: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  bold: { fontWeight: '600' },
  copyRow: { flexDirection: 'row', gap: Spacing.four },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  hint: { textAlign: 'center' },
  section: { gap: Spacing.two },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6 },
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
