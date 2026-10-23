import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RANGES, describeRange, type RangeKey, type RangeSpec } from '@/lib/signoz/queries';

/** The time window as one compact chip; tapping it opens the presets. Saves a whole row next to a filter bar. */
export function RangeChip({ value, onChange }: { value: RangeSpec; onChange: (key: RangeKey) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = 'key' in value ? value.key : null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Time range: ${describeRange(value)}`}
        onPress={() => setOpen(true)}
        style={[styles.chip, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <ThemedText type="small" style={styles.bold}>
          {describeRange(value)} ▾
        </ThemedText>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <View style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + Spacing.two }]}>
            <ThemedText type="caption" style={[styles.bold, styles.title]}>
              TIME RANGE
            </ThemedText>
            {RANGES.map((r) => (
              <Pressable
                key={r.key}
                accessibilityRole="button"
                accessibilityState={{ selected: r.key === selected }}
                onPress={() => {
                  onChange(r.key);
                  setOpen(false);
                }}
                style={styles.row}>
                <ThemedText style={r.key === selected ? { color: theme.accent, fontWeight: '700' } : undefined}>{describeRange({ key: r.key })}</ThemedText>
                {r.key === selected ? <ThemedText color="accent">✓</ThemedText> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '600' },
  chip: { paddingHorizontal: Spacing.three - 2, paddingVertical: 6, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: Radius.medium + 4, borderTopRightRadius: Radius.medium + 4, paddingTop: Spacing.three },
  title: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, letterSpacing: 0.6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 14 },
});
