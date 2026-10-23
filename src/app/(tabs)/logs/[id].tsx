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
  const [copied, setCopied] = useState(false);

  const log = useQuery({
    queryKey: ['log', client.endpoint, id],
    queryFn: ({ signal }) => fetchLogById(client, id, signal),
  });

  if (log.isPending) return <Loading />;
  if (log.isError) return <ErrorState error={log.error} onRetry={() => log.refetch()} />;
  if (!log.data) return <Empty title="Log not found" hint="It may be older than 30 days or have been dropped." />;
  const row = log.data;

  async function copy() {
    await Clipboard.setStringAsync(row.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        <Pressable accessibilityRole="button" onPress={copy}>
          <ThemedText type="small" color="accent" style={styles.bold}>
            {copied ? 'Copied' : 'Copy message'}
          </ThemedText>
        </Pressable>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  hint: { textAlign: 'center' },
  section: { gap: Spacing.two },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6 },
});
