import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { formatValue } from '@/lib/format';
import type { Series } from '@/lib/signoz/types';

interface LineChartProps {
  series: Series[];
  height?: number;
  /** Formats the y-axis labels; defaults to a compact number. */
  format?: (v: number) => string;
  /** Show a legend row for multi-series charts. */
  legend?: boolean;
}

const PADDING = 4;

export function LineChart({ series, height = 120, format = formatValue, legend }: LineChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const palette = [theme.accent, theme.info, theme.success, theme.warning, theme.danger];

  const points = series.flatMap((s) => s.points);
  const hasData = points.length > 0;
  const tMin = hasData ? Math.min(...points.map((p) => p.t)) : 0;
  const tMax = hasData ? Math.max(...points.map((p) => p.t)) : 1;
  const vMax = hasData ? Math.max(0, ...points.map((p) => p.v)) : 1;
  const vMin = hasData ? Math.min(0, ...points.map((p) => p.v)) : 0;
  const vSpan = vMax - vMin || 1;
  const tSpan = tMax - tMin || 1;

  const x = (t: number) => PADDING + ((t - tMin) / tSpan) * Math.max(0, width - PADDING * 2);
  const y = (v: number) => PADDING + (1 - (v - vMin) / vSpan) * (height - PADDING * 2);

  return (
    <View>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={styles.axis} pointerEvents="none">
          <ThemedText type="caption">{hasData ? format(vMax) : ''}</ThemedText>
          <ThemedText type="caption">{hasData ? format(vMin) : ''}</ThemedText>
        </View>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={0} x2={width} y1={y(vMin)} y2={y(vMin)} stroke={theme.border} strokeWidth={1} />
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
          </Svg>
        ) : null}
        {!hasData ? (
          <View style={styles.noData}>
            <ThemedText type="caption">No data in this range</ThemedText>
          </View>
        ) : null}
      </View>
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

const styles = StyleSheet.create({
  axis: { position: 'absolute', zIndex: 1, right: 0, top: 0, bottom: 0, justifyContent: 'space-between', alignItems: 'flex-end' },
  noData: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
