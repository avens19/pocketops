import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

export function Chip({ label, selected, onPress }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.card,
          borderColor: selected ? theme.accent : theme.border,
        },
      ]}>
      <ThemedText type="small" color={selected ? 'onAccent' : 'text'} style={styles.label}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontWeight: '600' },
});
