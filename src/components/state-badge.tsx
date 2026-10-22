import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AlertState } from '@/lib/signoz/types';

const STATE_COLOR: Record<AlertState, ThemeColor> = {
  firing: 'danger',
  pending: 'warning',
  recovering: 'warning',
  nodata: 'info',
  inactive: 'success',
  disabled: 'textSecondary',
};

const STATE_LABEL: Record<AlertState, string> = {
  firing: 'Firing',
  pending: 'Pending',
  recovering: 'Recovering',
  nodata: 'No data',
  inactive: 'OK',
  disabled: 'Disabled',
};

export function stateColor(state: AlertState): ThemeColor {
  return STATE_COLOR[state];
}

export function StateBadge({ state }: { state: AlertState }) {
  const theme = useTheme();
  const color = theme[STATE_COLOR[state]];
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText type="caption" style={{ color, fontWeight: '700' }}>
        {STATE_LABEL[state]}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
