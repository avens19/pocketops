import { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { formatValue } from '@/lib/format';
import type { Series } from '@/lib/signoz/types';

interface LineChartProps {
  series: Series[];
  height?: number;
  /** Formats the y-axis labels and the scrub readout; defaults to a compact number. */
  format?: (v: number) => string;
  /** Show a legend row for multi-series charts. */
  legend?: boolean;
}

const PAD_TOP = 8;
const PAD_BOTTOM = 4;
const GUTTER = 46;

/** Clock time, plus the day when the chart spans more than a few hours and the time alone could be either day. */
function timeLabel(t: number, spanMs: number): { time: string; day?: string } {
  const d = new Date(t);
  if (spanMs > 36 * 3_600_000) return { time: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return spanMs > 6 * 3_600_000 ? { time, day: d.toLocaleDateString(undefined, { weekday: 'short' }) } : { time };
}

function readoutTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function LineChart({ series, height = 140, format = formatValue, legend }: LineChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const palette = [theme.accent, theme.info, theme.success, theme.warning, theme.danger];

  const points = series.flatMap((s) => s.points);
  const hasData = points.length > 0;
  const tMin = hasData ? Math.min(...points.map((p) => p.t)) : 0;
  const tMax = hasData ? Math.max(...points.map((p) => p.t)) : 1;
  const vMax = hasData ? Math.max(0, ...points.map((p) => p.v)) : 1;
  const vMin = hasData ? Math.min(0, ...points.map((p) => p.v)) : 0;
  const vSpan = vMax - vMin || 1;
  const tSpan = tMax - tMin || 1;

  const plotW = Math.max(0, width - GUTTER);
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const x = (t: number) => ((t - tMin) / tSpan) * plotW;
  const y = (v: number) => PAD_TOP + (1 - (v - vMin) / vSpan) * plotH;
  const gridValues = [vMax, vMin + vSpan / 2, vMin];

  // Every distinct timestamp across series, so a scrub snaps to a real bucket.
  const times = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b), [series]);

  // Rebuilt when the geometry changes, so its handlers always read the current layout.
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim only a horizontal drag or a tap, so vertical scrolling of the page still works.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 3,
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (e) => setCursor(nearestTime(e.nativeEvent.locationX, { plotW, tMin, tSpan, times })),
        onPanResponderMove: (e) => setCursor(nearestTime(e.nativeEvent.locationX, { plotW, tMin, tSpan, times })),
        onPanResponderRelease: () => setCursor(null),
        onPanResponderTerminate: () => setCursor(null),
      }),
    [plotW, tMin, tSpan, times],
  );

  // A chart is a picture; this is what it says, for a screen reader.
  const latest = series[0]?.points[series[0].points.length - 1];
  const summary = hasData
    ? `Line chart${series.length > 1 ? ` of ${series.length} series` : ''}. ${latest ? `Latest ${format(latest.v)}. ` : ''}Lowest ${format(vMin)}, highest ${format(vMax)}.`
    : 'Line chart with no data in this range.';

  const readout = cursor === null ? [] : series.flatMap((s, i) => {
    const p = s.points.find((q) => q.t === cursor);
    return p ? [{ name: s.name, v: p.v, color: palette[i % palette.length] }] : [];
  });

  return (
    <View>
      <View style={styles.readout}>
        {cursor !== null ? (
          <>
            <ThemedText type="caption">{readoutTime(cursor)}</ThemedText>
            {readout.map((r, i) => (
              <ThemedText key={`${r.name}-${i}`} type="small" style={[styles.readoutValue, { color: r.color }]}>
                {series.length > 1 ? `${r.name}: ` : ''}
                {format(r.v)}
              </ThemedText>
            ))}
          </>
        ) : (
          <ThemedText type="caption">{hasData ? 'Touch the chart to read a value' : ' '}</ThemedText>
        )}
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        {width > 0 ? (
          <Svg width={width} height={height} pointerEvents="none">
            {gridValues.map((v, i) => (
              <Line key={i} x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke={theme.border} strokeWidth={1} strokeDasharray={i === 2 ? undefined : '3,4'} />
            ))}
            {series.map((s, i) =>
              s.points.length > 1 ? (
                <Polyline
                  key={`${s.name}-${i}`}
                  points={s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')}
                  fill="none"
                  stroke={palette[i % palette.length]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null,
            )}
            {cursor !== null ? (
              <>
                <Line x1={x(cursor)} x2={x(cursor)} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke={theme.textSecondary} strokeWidth={1} />
                {series.map((s, i) => {
                  const p = s.points.find((q) => q.t === cursor);
                  return p ? <Circle key={`${s.name}-${i}`} cx={x(p.t)} cy={y(p.v)} r={4} fill={palette[i % palette.length]} stroke={theme.card} strokeWidth={2} /> : null;
                })}
              </>
            ) : null}
          </Svg>
        ) : null}
        <View style={[styles.axis, { width: GUTTER }]} pointerEvents="none">
          {hasData ? gridValues.map((v, i) => (
            <ThemedText key={i} type="caption" numberOfLines={1} style={[styles.axisLabel, { top: y(v) - 8 }]}>
              {format(v)}
            </ThemedText>
          )) : null}
        </View>
        {!hasData ? (
          <View style={styles.noData} pointerEvents="none">
            <ThemedText type="caption">No data in this range</ThemedText>
          </View>
        ) : null}
      </View>
      {hasData ? (
        <View style={[styles.xAxis, { marginRight: GUTTER }]} pointerEvents="none">
          {[tMin, tMin + tSpan / 2, tMax].map((t, i) => {
            const label = timeLabel(t, tSpan);
            return (
              <View key={i} style={i === 0 ? styles.tickStart : i === 2 ? styles.tickEnd : styles.tickMid}>
                <ThemedText type="caption">{label.time}</ThemedText>
                {label.day ? <ThemedText type="caption" style={{ color: theme.textSecondary }}>{label.day}</ThemedText> : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {legend && series.length > 1 ? (
        <View style={styles.legend}>
          {series.map((s, i) => (
            <View key={`${s.name}-${i}`} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: palette[i % palette.length] }]} />
              <ThemedText type="caption">{s.name}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The bucket timestamp closest to a touch at `locationX`. */
function nearestTime(locationX: number, g: { plotW: number; tMin: number; tSpan: number; times: number[] }): number | null {
  if (g.times.length === 0 || g.plotW <= 0) return null;
  const t = g.tMin + (Math.min(Math.max(locationX, 0), g.plotW) / g.plotW) * g.tSpan;
  let best = g.times[0];
  for (const c of g.times) if (Math.abs(c - t) < Math.abs(best - t)) best = c;
  return best;
}

const styles = StyleSheet.create({
  readout: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  readoutValue: { fontWeight: '700' },
  axis: { position: 'absolute', right: 0, top: 0, bottom: 0 },
  axisLabel: { position: 'absolute', right: 0, textAlign: 'right', width: GUTTER - 4 },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tickStart: { alignItems: 'flex-start' },
  tickMid: { alignItems: 'center' },
  tickEnd: { alignItems: 'flex-end' },
  noData: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
