import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Spacing } from '@/constants/theme';
import { RANGES, type RangeKey } from '@/lib/signoz/queries';

export function RangePicker({ value, onChange }: { value: RangeKey | null; onChange: (key: RangeKey) => void }) {
  return (
    <View style={styles.row}>
      {RANGES.map((r) => (
        <Chip key={r.key} label={r.label} selected={r.key === value} onPress={() => onChange(r.key)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
});
