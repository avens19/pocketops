import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { KeyValues } from '@/components/key-values';
import { ErrorState, Loading } from '@/components/query-state';
import { StateBadge, stateColor } from '@/components/state-badge';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useRules } from '@/hooks/use-rules';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { formatTime, formatValue, timeAgo } from '@/lib/format';
import { listFiringAlerts, ruleTimeline } from '@/lib/signoz/api';
import { rangeFor } from '@/lib/signoz/queries';

export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useClient();
  const theme = useTheme();
  const rules = useRules();
  const rule = rules.data?.find((r) => r.id === id);

  const firing = useQuery({
    queryKey: ['firing', client.endpoint],
    queryFn: ({ signal }) => listFiringAlerts(client, signal),
    refetchInterval: 30_000,
  });
  const timeline = useQuery({
    queryKey: ['timeline', client.endpoint, id],
    queryFn: ({ signal }) => ruleTimeline(client, id, rangeFor('7d'), signal),
  });

  const instances = useMemo(
    () =>
      (firing.data ?? []).filter(
        (a) => (rule && a.ruleName === rule.name) || a.labels.ruleId === id,
      ),
    [firing.data, rule, id],
  );

  if (rules.isPending) return <Loading />;
  if (rules.isError && !rules.data) return <ErrorState error={rules.error} onRetry={() => rules.refetch()} />;
  if (!rule) return <ErrorState error={new Error('That alert rule no longer exists.')} />;

  const refreshing = rules.isRefetching || firing.isRefetching || timeline.isRefetching;
  const refresh = () => {
    rules.refetch();
    firing.refetch();
    timeline.refetch();
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: rule.name }} />

      <View style={styles.titleBlock}>
        <StateBadge state={rule.state} />
        <ThemedText type="title" style={styles.title}>
          {rule.name}
        </ThemedText>
        {rule.description ? <ThemedText color="textSecondary">{rule.description}</ThemedText> : null}
      </View>

      {instances.length > 0 ? (
        <Section title={`Firing now (${instances.length})`}>
          {instances.map((a) => (
            <Card key={a.fingerprint}>
              <ThemedText type="small" color="danger" style={styles.bold}>
                Since {timeAgo(a.startsAt)}
                {a.silenced ? ' · silenced' : ''}
              </ThemedText>
              {a.annotations.summary || a.annotations.description ? (
                <ThemedText type="small">{a.annotations.summary ?? a.annotations.description}</ThemedText>
              ) : null}
              <KeyValues
                values={Object.fromEntries(
                  Object.entries(a.labels).filter(([k]) => !['alertname', 'ruleId', 'ruleSource'].includes(k)),
                )}
              />
            </Card>
          ))}
        </Section>
      ) : null}

      <Section title="Last 7 days">
        {timeline.isPending ? (
          <Loading />
        ) : timeline.isError ? (
          <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />
        ) : (timeline.data ?? []).length === 0 ? (
          <ThemedText type="small" color="textSecondary">
            No state changes recorded.
          </ThemedText>
        ) : (
          <Card style={styles.timeline}>
            {(timeline.data ?? []).map((t, i) => (
              <View key={`${t.unixMilli}-${i}`} style={styles.timelineRow}>
                <View style={[styles.dot, { backgroundColor: theme[stateColor(t.state)] }]} />
                <View style={styles.flex}>
                  <ThemedText type="small" style={styles.bold}>
                    {t.state === 'inactive' ? 'Resolved' : t.state[0]!.toUpperCase() + t.state.slice(1)}
                    {Number.isFinite(t.value) ? ` · value ${formatValue(t.value)}` : ''}
                  </ThemedText>
                  <ThemedText type="caption">{formatTime(t.unixMilli)}</ThemedText>
                </View>
              </View>
            ))}
          </Card>
        )}
      </Section>

      {Object.keys(rule.labels).length > 0 ? (
        <Section title="Labels">
          <Card>
            <KeyValues values={rule.labels} />
          </Card>
        </Section>
      ) : null}

      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(`${client.endpoint}/alerts/overview?ruleId=${encodeURIComponent(rule.id)}`)}
        style={styles.openLink}>
        <ThemedText color="accent" style={styles.bold}>
          Open in SigNoz
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="caption" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  titleBlock: { gap: Spacing.two },
  title: { fontSize: 24, lineHeight: 30 },
  section: { gap: Spacing.two },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6 },
  bold: { fontWeight: '600' },
  timeline: { gap: Spacing.three },
  timelineRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  openLink: { alignItems: 'center', paddingVertical: Spacing.two },
});
