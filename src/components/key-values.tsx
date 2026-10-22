import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export function KeyValues({ values }: { values: Record<string, string> }) {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  return (
    <View style={styles.list}>
      {entries.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <ThemedText type="caption">{k}</ThemedText>
          <ThemedText type="mono" selectable>
            {v}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: { gap: 1 },
});
