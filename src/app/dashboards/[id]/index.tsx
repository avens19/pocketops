import { useQuery } from '@tanstack/react-query';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { DashboardPanel } from '@/components/dashboard-panel';
import { DashboardVariablePicker } from '@/components/dashboard-variable';
import { ErrorState, Loading } from '@/components/query-state';
import { RangeChip } from '@/components/range-chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { relativeTimeMs } from '@/lib/deeplink';
import { dashboardSections, dashboardTitle, defaultVariables, getDashboard, variableProblem, type Dashboard } from '@/lib/signoz/dashboards';
import { resolveRange, type RangeSpec } from '@/lib/signoz/queries';

const viewabilityConfig = { itemVisiblePercentThreshold: 1 };
type Row = { key: string; section: string; title?: string; panelId?: string; count?: number };
export default function DashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useClient();
  const dashboard = useQuery({ queryKey: ['dashboard', client.endpoint, id], queryFn: ({ signal }) => getDashboard(client, id, signal) });
  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  return <DashboardContent key={`${client.endpoint}:${id}`} dashboard={dashboard.data} />;
}
function DashboardContent({ dashboard }: { dashboard: Dashboard }) {
  const insets = useSafeAreaInsets();
  const sections = dashboardSections(dashboard);
  const variables = dashboard.spec.variables ?? [];
  const [values, setValues] = useState(() => defaultVariables(variables));
  const [editing, setEditing] = useState<string>();
  const [range, setRange] = useState<RangeSpec>(() => { const lastMs = relativeTimeMs(dashboard.spec.duration || '1h'); return lastMs && lastMs > 0 ? { lastMs } : { key: '1h' }; });
  const [anchor, setAnchor] = useState(Date.now);
  const [open, setOpen] = useState(() => new Set(sections.filter((s) => s.open).map((s) => s.id)));
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [onViewableItemsChanged] = useState(() => ({ viewableItems }: { viewableItems: { item: Row }[] }) => setVisible(new Set(viewableItems.map((v) => v.item.key))));
  const rows: Row[] = sections.flatMap((s) => [{ key: s.id, section: s.id, title: s.title, count: s.panels.length }, ...(open.has(s.id) ? s.panels.map((panelId) => ({ key: `panel:${panelId}`, section: s.id, panelId })) : [])]);
  const resolved = resolveRange(range, anchor);
  const problem = variableProblem(variables, values);
  const variable = variables.find((v) => v.spec.name === editing);
  return <>
    <Stack.Screen options={{ title: dashboardTitle(dashboard) }} />
    <FlatList data={rows} keyExtractor={(item) => item.key} extraData={[visible, focused, values, resolved, open]}
      contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: Spacing.three, paddingBottom: insets.bottom + Spacing.three, gap: Spacing.two }}
      initialNumToRender={4} maxToRenderPerBatch={4} windowSize={5} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => setAnchor(Date.now())} />}
      ListHeaderComponent={<View style={{ gap: 12, marginBottom: 8 }}>
        {dashboard.spec.display?.description ? <ThemedText type="small">{dashboard.spec.display.description}</ThemedText> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <RangeChip value={range} onChange={(key) => { setRange({ key }); setAnchor(Date.now()); }} />
          <Chip label="Refresh" onPress={() => setAnchor(Date.now())} />
          {variables.map((v) => <Chip key={v.spec.name} label={`${v.spec.display?.name || v.spec.name}: ${values[v.spec.name]?.value === '__all__' ? 'All' : Array.isArray(values[v.spec.name]?.value) ? (values[v.spec.name].value as string[]).join(', ') || 'Choose' : values[v.spec.name]?.value || 'Choose'}`} onPress={() => setEditing(v.spec.name)} />)}
        </View>
        {problem ? <ThemedText color="warning" type="small">{problem}</ThemedText> : null}
      </View>}
      ListEmptyComponent={<ThemedText>No panels in this dashboard.</ThemedText>}
      renderItem={({ item }) => item.panelId ? <View onLayout={(e) => { if (visible.has(item.key)) { const height = e.nativeEvent.layout.height; setHeights((current) => current[item.key] === height ? current : { ...current, [item.key]: height }); } }}>
        <Card>{focused && visible.has(item.key) && (!problem || dashboard.spec.panels[item.panelId].spec.plugin.kind === 'signoz/TextPanel') ? <DashboardPanel dashboardId={dashboard.id} panelId={item.panelId} panel={dashboard.spec.panels[item.panelId]} variables={values} range={resolved} enabled /> : <View style={{ height: Math.max(70, (heights[item.key] ?? 260) - 32) }}><ThemedText type="heading">{dashboard.spec.panels[item.panelId].spec.display?.name || item.panelId}</ThemedText><ThemedText type="caption">{problem ? 'Choose variables above to load this panel.' : 'Loads when visible'}</ThemedText></View>}</Card>
      </View> : <Pressable accessibilityRole="button" accessibilityState={{ expanded: open.has(item.section) }} onPress={() => setOpen((current) => { const next = new Set(current); if (next.has(item.section)) next.delete(item.section); else next.add(item.section); return next; })} style={{ paddingVertical: 12 }}>
        <ThemedText type="heading">{open.has(item.section) ? '▾' : '▸'} {item.title} · {item.count}</ThemedText>
      </Pressable>} />
    {variable ? <DashboardVariablePicker variable={variable} initial={values[variable.spec.name]} range={resolved} onClose={() => setEditing(undefined)} onApply={(value) => { setValues({ ...values, [variable.spec.name]: value }); setAnchor(Date.now()); setEditing(undefined); }} /> : null}
  </>;
}
