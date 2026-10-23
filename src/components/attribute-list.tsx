import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { explorer, type ExplorerSignal } from '@/lib/explorer-state';
import { inferValue, isValidKey } from '@/lib/filters';

interface AttributeListProps {
  values: Record<string, string>;
  /** The explorer a tap filters first; the other is offered as a secondary action. */
  primary: ExplorerSignal;
  /** Offer to filter the other explorer too. Off for fields only one signal has (a log's `body.*`). */
  secondary?: boolean;
}

const LABEL: Record<ExplorerSignal, string> = { logs: 'logs', traces: 'traces' };

/** Key/value rows where tapping one opens "add to filter / exclude / copy". The explorer it filters is the point of the screen. */
export function AttributeList({ values, primary, secondary = true }: AttributeListProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<{ key: string; value: string } | null>(null);
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <View style={styles.list}>
        {entries.map(([key, value]) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`${key} ${value}. Filter options`}
            onPress={() => setSelected({ key, value })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="caption">{key}</ThemedText>
            <ThemedText type="mono">{value}</ThemedText>
          </Pressable>
        ))}
      </View>
      <AttributeMenu attribute={selected} primary={primary} secondary={secondary} onClose={() => setSelected(null)} />
    </>
  );
}

function AttributeMenu({ attribute, primary, secondary: offerSecondary, onClose }: { attribute: { key: string; value: string } | null; primary: ExplorerSignal; secondary: boolean; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const secondary: ExplorerSignal = primary === 'logs' ? 'traces' : 'logs';
  const [copied, setCopied] = useState(false);

  function apply(signal: ExplorerSignal, op: '=' | '!=') {
    if (!attribute) return;
    explorer.investigate(signal, { kind: 'filter', key: attribute.key, op, value: inferValue(attribute.value) });
    onClose();
    router.navigate(signal === 'logs' ? '/logs' : '/traces');
  }

  async function copy() {
    if (!attribute) return;
    await Clipboard.setStringAsync(attribute.value);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 500);
  }

  // A key that cannot be written as a bare field name would change the query if interpolated, so it only offers copy.
  const canFilter = attribute ? isValidKey(attribute.key) : false;
  const items: { label: string; hint?: string; filters: boolean; onPress: () => void }[] = attribute
    ? [
        { label: `Show only ${LABEL[primary]} with this`, hint: `${attribute.key} is ${attribute.value}`, filters: true, onPress: () => apply(primary, '=') },
        { label: `Hide ${LABEL[primary]} with this`, hint: `${attribute.key} is not ${attribute.value}`, filters: true, onPress: () => apply(primary, '!=') },
        ...(offerSecondary ? [{ label: `Show ${LABEL[secondary]} with this`, filters: true, onPress: () => apply(secondary, '=') }] : []),
        { label: copied ? 'Copied' : 'Copy value', filters: false, onPress: copy },
      ].filter((item) => canFilter || !item.filters)
    : [];

  return (
    <Modal visible={attribute !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <View style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + Spacing.two }]}>
          {attribute ? (
            <View style={styles.title}>
              <ThemedText type="caption">{attribute.key}</ThemedText>
              <ThemedText type="mono" numberOfLines={3}>
                {attribute.value}
              </ThemedText>
            </View>
          ) : null}
          {items.map((item) => (
            <Pressable key={item.label} accessibilityRole="button" onPress={item.onPress} style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText>{item.label}</ThemedText>
              {item.hint ? <ThemedText type="caption">{item.hint}</ThemedText> : null}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: -Spacing.three },
  row: { gap: 1, paddingHorizontal: Spacing.three, paddingVertical: 7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: Radius.medium + 4, borderTopRightRadius: Radius.medium + 4, paddingTop: Spacing.two },
  title: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three - 2, gap: 2 },
  item: { paddingHorizontal: Spacing.three, paddingVertical: 14, gap: 2 },
});
