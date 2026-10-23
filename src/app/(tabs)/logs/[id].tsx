import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { AttributeList } from '@/components/attribute-list';
import { Chip } from '@/components/chip';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { severityColor } from '@/components/severity';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { explorer } from '@/lib/explorer-state';
import { formatTime } from '@/lib/format';
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

  if (log.isPending) return <Loading />;
  if (log.isError) return <ErrorState error={log.error} onRetry={() => log.refetch()} />;
  if (!log.data) return <Empty title="Log not found" hint="It may be older than 30 days or have been dropped." />;
  const row = log.data;

  async function copy(what: 'message' | 'json') {
    const text =
      what === 'message'
        ? row.body
        : JSON.stringify(
            { timestamp: row.timestamp, severity: row.severity, body: row.body, service: row.service, trace_id: row.traceId, attributes: row.attributes, resources: row.resources },
            null,
            2,
          );
    await Clipboard.setStringAsync(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
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
        <ThemedText type="mono" selectable>
          {row.body}
        </ThemedText>
        <View style={styles.copyRow}>
          <Pressable accessibilityRole="button" onPress={() => copy('message')}>
            <ThemedText type="small" color="accent" style={styles.bold}>
              {copied === 'message' ? 'Copied' : 'Copy message'}
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
  content: { padding: Spacing.three, gap: Spacing.three },
  meta: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  bold: { fontWeight: '600' },
  copyRow: { flexDirection: 'row', gap: Spacing.four },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  hint: { textAlign: 'center' },
  section: { gap: Spacing.two },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6 },
});
