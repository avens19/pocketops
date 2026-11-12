import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Chip } from './chip';
import { LineChart } from './line-chart';
import { ErrorState, Loading } from './query-state';
import { ThemedText } from './themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { dashboardFormat, dashboardResults, drillExpression } from '@/lib/dashboard-results';
import { logsHref, tracesHref } from '@/lib/explore-links';
import { dashboardRequest } from '@/lib/request-pool';
import { queryRange } from '@/lib/signoz/api';
import { dashboardPanelRequest, panelRange, type DashboardPanel as Panel, type DashboardValues } from '@/lib/signoz/dashboards';
import type { TimeRange } from '@/lib/signoz/queries';
import type { QueryEnvelope } from '@/lib/signoz/views';

export function DashboardPanel({ dashboardId, panelId, panel, variables, range, enabled, expanded = false }: {
  dashboardId: string; panelId: string; panel: Panel; variables: DashboardValues; range: TimeRange; enabled: boolean; expanded?: boolean;
}) {
  const client = useClient();
  const theme = useTheme();
  const palette = [theme.accent, theme.info, theme.success, theme.warning, theme.danger];
  const text = panel.spec.plugin.kind === 'signoz/TextPanel';
  let request: ReturnType<typeof dashboardPanelRequest> | undefined;
  let problem: Error | undefined;
  try { if (!text) request = dashboardPanelRequest(panel, variables, range); } catch (e) { problem = e as Error; }
  const result = useQuery({ queryKey: ['dashboard-panel', client.endpoint, dashboardId, panelId, request], enabled: enabled && !!request && !problem,
    queryFn: ({ signal }) => dashboardRequest(() => queryRange(client, request!, signal), signal), staleTime: 60_000, gcTime: 120_000 });
  const open = () => router.push({ pathname: '/dashboards/[id]/panel', params: { id: dashboardId, panel: panelId, variables: JSON.stringify(variables), from: String(range.startMs), to: String(range.endMs) } });
  let parsed: ReturnType<typeof dashboardResults> = { rows: [], series: [] };
  try { if (result.data) parsed = dashboardResults(panel, result.data); } catch (e) { problem = e as Error; }
  const formatting = panel.spec.plugin.spec.formatting as { unit?: string; decimalPrecision?: string } | undefined;
  const format = (value: number, unit = formatting?.unit) => dashboardFormat(value, unit, formatting?.decimalPrecision);
  const queryRangeForPanel = problem ? range : panelRange(panel, range);
  function drill(query: QueryEnvelope, expression: string) {
    const p = { q: expression || undefined, from: String(queryRangeForPanel.startMs), to: String(queryRangeForPanel.endMs) };
    // A deliberately new route signature applies the resolved filter, leaving the dashboard on the back stack.
    router.push(query.spec.signal === 'logs' ? logsHref({ ...p, q: expression || 'timestamp EXISTS' }) : tracesHref({ ...p, q: expression || 'trace_id EXISTS' }));
  }
  const show = expanded ? 200 : 4;
  const chart = request?.requestType === 'time_series';
  const chartSeries = parsed.series.slice(0, 50).map((s) => s.series);
  return <View style={{ gap: 10 }}>
    <Pressable accessibilityRole={expanded ? 'header' : 'button'} onPress={expanded ? undefined : open}>
      <ThemedText type="heading">{panel.spec.display?.name || panelId}</ThemedText>
      {panel.spec.display?.description ? <ThemedText type="caption">{panel.spec.display.description}</ThemedText> : null}
    </Pressable>
    {queryRangeForPanel.startMs !== range.startMs ? <ThemedText type="caption">Panel range: {new Date(queryRangeForPanel.startMs).toLocaleString()} – {new Date(queryRangeForPanel.endMs).toLocaleString()}</ThemedText> : null}
    {text ? <MarkdownText text={String(panel.spec.plugin.spec.text ?? '')} /> : problem ? <ErrorState error={problem} /> : result.isError ? <ErrorState error={result.error} onRetry={() => void result.refetch()} /> : result.isPending ? enabled ? <Loading /> : <ThemedText type="caption">Loads when visible</ThemedText> : <>
      {chart ? <LineChart series={chartSeries} height={expanded ? 260 : 160} format={format} variant={panel.spec.plugin.kind === 'signoz/BarChartPanel' ? 'stacked-bars' : 'line'} /> : null}
      {chart && parsed.series.length > 50 ? <ThemedText type="caption">Chart shows the first 50 of {parsed.series.length} series.</ThemedText> : null}
      {chart ? parsed.series.slice(0, show).map((s, i) => {
        const expression = drillExpression(s.query, variables, s.groups);
        return <View key={i} style={{ gap: 4 }}><ThemedText type="small" style={{ color: palette[i % palette.length] }}>{s.series.name}: {s.series.points.length ? format(s.series.points.at(-1)!.v) : '—'}</ThemedText>
          {expanded && expression !== null ? <Chip label={`Explore ${s.query.spec.signal}`} onPress={() => drill(s.query, expression)} /> : null}
        </View>;
      }) : parsed.rows.slice(0, show).map((row, i) => {
        const expression = drillExpression(row.query, variables, row.groups);
        return <View key={i} style={{ gap: 6, paddingVertical: 8 }}>
          <ThemedText type="small">{Object.entries(row.groups).map(([key, value]) => `${key}: ${value ?? '(not set)'}`).join(' · ') || String(row.query.spec.name)}</ThemedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{row.values.map((v, n) => <View key={n} style={{ minWidth: 70 }}>
            <ThemedText type="caption">{v.name}</ThemedText><ThemedText type="mono">{typeof v.value === 'number' ? format(v.value, v.unit) : String(v.value ?? '—')}</ThemedText>
          </View>)}</View>
          {expanded && expression !== null ? <Chip label={`Explore ${row.query.spec.signal}`} onPress={() => drill(row.query, expression)} /> : null}
        </View>;
      })}
      {!parsed.rows.length && !parsed.series.length ? <ThemedText type="caption">No data in this time range.</ThemedText> : null}
      {(chart ? parsed.series.length : parsed.rows.length) > show ? <ThemedText type="caption">Showing {show} of {chart ? parsed.series.length : parsed.rows.length} {chart ? 'series' : 'rows'}.</ThemedText> : null}
    </>}
    {!expanded && !text ? <Chip label="Expand panel" onPress={open} /> : null}
  </View>;
}

/** Plain markdown blocks and inline emphasis; remote HTML is never executed. */
function MarkdownText({ text }: { text: string }) {
  return <View style={{ gap: 8 }}>{text.split(/\n\s*\n/).map((block, i) => <ThemedText key={i} type={/^#{1,6} /.test(block) ? 'heading' : 'small'} selectable>
    {block.replace(/^#{1,6} /, '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, n) => part.startsWith('**') ? <ThemedText key={n} type="small" style={{ fontWeight: '700' }}>{part.slice(2, -2)}</ThemedText> : part.startsWith('`') ? <ThemedText key={n} type="mono">{part.slice(1, -1)}</ThemedText> : part)}
  </ThemedText>)}</View>;
}
