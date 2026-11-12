import { useQuery } from '@tanstack/react-query';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/card';
import { DashboardPanel } from '@/components/dashboard-panel';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { defaultVariables, getDashboard, variableProblem, type DashboardValues } from '@/lib/signoz/dashboards';
import { rangeSpecFromParams, resolveRange } from '@/lib/signoz/queries';

export default function DashboardPanelScreen() {
  const params = useLocalSearchParams<{ id: string; panel: string; variables?: string; from?: string; to?: string }>();
  const client = useClient();
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const dashboard = useQuery({ queryKey: ['dashboard', client.endpoint, params.id], queryFn: ({ signal }) => getDashboard(client, params.id, signal) });
  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  const panel = dashboard.data.spec.panels[params.panel];
  if (!panel) return <Empty title="Panel not found" />;
  let variables: DashboardValues = defaultVariables(dashboard.data.spec.variables ?? []);
  try {
    if (params.variables) {
      const parsed = JSON.parse(params.variables) as DashboardValues;
      for (const [key, entry] of Object.entries(parsed)) {
        if (!variables[key] || !entry || entry.type !== variables[key].type || !(typeof entry.value === 'string' || (Array.isArray(entry.value) && entry.value.every((v) => typeof v === 'string')))) throw new Error('Invalid dashboard variables.');
      }
      variables = { ...variables, ...parsed };
    }
  } catch { return <Empty title="Invalid panel link" hint="Open the panel from its dashboard." />; }
  const problem = variableProblem(dashboard.data.spec.variables ?? [], variables);
  const range = rangeSpecFromParams(params);
  if (problem || !range) return <Empty title={problem || 'Choose a time range from the dashboard.'} />;
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: Spacing.three, paddingBottom: insets.bottom + Spacing.three }}>
    <Stack.Screen options={{ title: panel.spec.display?.name || 'Panel' }} />
    <Card>{focused ? <DashboardPanel dashboardId={params.id} panelId={params.panel} panel={panel} variables={variables} range={resolveRange(range)} enabled expanded /> : null}</Card>
  </ScrollView>;
}
