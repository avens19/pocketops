import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useDebounced } from '@/hooks/use-debounced';
import { useTheme } from '@/hooks/use-theme';
import { useClient } from '@/lib/auth';
import { explorer, type ExplorerSignal } from '@/lib/explorer-state';
import { OP_LABEL, UNARY_OPS, inferValue, isValidKey, type Clause, type FilterOp } from '@/lib/filters';
import { fetchFieldKeys, fetchFieldValues } from '@/lib/signoz/api';
import type { TimeRange } from '@/lib/signoz/queries';

const PICKER_OPS: FilterOp[] = ['=', '!=', 'IN', 'NOT IN', 'CONTAINS', 'NOT CONTAINS', '>', '<', 'EXISTS', 'NOT EXISTS'];

interface FilterEditorProps {
  visible: boolean;
  signal: ExplorerSignal;
  range: TimeRange;
  /** The clause being edited; omitted when adding. */
  initial?: Clause;
  onClose: () => void;
  onSubmit: (clause: Clause) => void;
}

function Sheet({ visible, title, onClose, onApply, canApply, children }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onApply: () => void;
  canApply: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.page, { backgroundColor: theme.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.headerSide}>
            <ThemedText color="textSecondary">Cancel</ThemedText>
          </Pressable>
          <ThemedText type="heading">{title}</ThemedText>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canApply }} disabled={!canApply} onPress={onApply} hitSlop={8} style={[styles.headerSide, styles.headerRight]}>
            <ThemedText color={canApply ? 'accent' : 'textSecondary'} style={styles.bold}>
              Apply
            </ThemedText>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Spacing.four }]}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="caption" style={styles.bold}>
        {label.toUpperCase()}
      </ThemedText>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.textSecondary}
        {...props}
        style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }, props.multiline ? styles.multiline : null, props.style]}
      />
    </View>
  );
}

/** Mounted only while open, so each opening starts from `initial` without a reset effect. */
export function FilterEditor(props: FilterEditorProps) {
  return props.visible ? <FilterForm {...props} /> : null;
}

function initialValueText(initial: Clause | undefined): string {
  if (initial?.kind !== 'filter') return '';
  if (initial.values) return initial.values.join(', ');
  return initial.value === undefined ? '' : String(initial.value);
}

function FilterForm({ signal, range, initial, onClose, onSubmit }: FilterEditorProps) {
  const client = useClient();
  const theme = useTheme();
  const [key, setKey] = useState(initial?.kind === 'filter' ? initial.key : '');
  const [op, setOp] = useState<FilterOp>(initial?.kind === 'filter' ? initial.op : '=');
  const [valueText, setValueText] = useState(initialValueText(initial));
  const [rawText, setRawText] = useState(initial?.kind === 'raw' ? initial.text : '');
  const [keyFocused, setKeyFocused] = useState(initial === undefined);

  const isRaw = initial?.kind === 'raw';
  const unary = UNARY_OPS.includes(op);
  const windowKey = Math.floor(range.startMs / 60_000);

  const debouncedKey = useDebounced(key);
  const keys = useQuery({
    queryKey: ['field-keys', client.endpoint, signal, debouncedKey, windowKey],
    queryFn: ({ signal: abort }) => fetchFieldKeys(client, signal, debouncedKey, range, abort),
    enabled: !isRaw,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const debouncedValue = useDebounced(valueText);
  const values = useQuery({
    queryKey: ['field-values', client.endpoint, signal, key, debouncedValue, windowKey],
    queryFn: ({ signal: abort }) => fetchFieldValues(client, signal, key, debouncedValue, range, abort),
    enabled: !isRaw && !!key && !unary,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const exactKey = keys.data?.some((k) => k.name === key);
  const keySuggestions = keyFocused && !exactKey ? (keys.data ?? []).slice(0, 12) : [];
  const keyOk = isValidKey(key.trim());
  const canApply = isRaw ? rawText.trim().length > 0 : keyOk && (unary || valueText.trim().length > 0);
  const list = op === 'IN' || op === 'NOT IN';

  function apply() {
    if (isRaw) return onSubmit({ kind: 'raw', text: rawText.trim() });
    // Nothing edited: hand back the original clause, so a literal's type (007, 'true', a list) is never reinterpreted.
    if (initial?.kind === 'filter' && op === initial.op && key.trim() === initial.key && valueText === initialValueText(initial)) return onSubmit(initial);
    const k = key.trim();
    if (unary) return onSubmit({ kind: 'filter', key: k, op });
    const text = valueText.trim();
    if (op === 'CONTAINS' || op === 'NOT CONTAINS') return onSubmit({ kind: 'filter', key: k, op, value: text });
    if (list) return onSubmit({ kind: 'filter', key: k, op, values: text.split(',').map((p) => p.trim()).filter(Boolean).map(inferValue) });
    return onSubmit({ kind: 'filter', key: k, op, value: inferValue(text) });
  }

  if (isRaw) {
    return (
      <Sheet visible title="Edit clause" onClose={onClose} onApply={apply} canApply={canApply}>
        <Field label="Clause" value={rawText} onChangeText={setRawText} multiline autoFocus />
        <ThemedText type="caption">This clause uses syntax the filter builder can&apos;t show as a chip, so it is edited as text.</ThemedText>
      </Sheet>
    );
  }

  return (
    <Sheet visible title={initial ? 'Edit filter' : 'Add filter'} onClose={onClose} onApply={apply} canApply={canApply}>
      <Field label="Field" value={key} onChangeText={setKey} onFocus={() => setKeyFocused(true)} onBlur={() => setKeyFocused(false)} placeholder="service.name" autoFocus={initial === undefined} />
      {key.trim() && !keyOk ? (
        <ThemedText type="caption" color="danger">
          A field name has letters, digits and . _ - : only. Use “Edit query” for anything else.
        </ThemedText>
      ) : null}
      {keySuggestions.length > 0 ? (
        <View style={[styles.suggestions, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {keySuggestions.map((k, i) => (
            <Pressable
              key={k.name}
              accessibilityRole="button"
              onPress={() => {
                setKey(k.name);
                setKeyFocused(false);
              }}
              style={[styles.suggestion, i > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
              <ThemedText type="small" style={styles.flex} numberOfLines={1}>
                {k.name}
              </ThemedText>
              <ThemedText type="caption">{[k.context, k.dataType].filter(Boolean).join(' · ')}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.field}>
        <ThemedText type="caption" style={styles.bold}>
          CONDITION
        </ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.ops}>
          {PICKER_OPS.map((o) => (
            <Chip key={o} label={OP_LABEL[o]} selected={op === o} onPress={() => setOp(o)} />
          ))}
        </ScrollView>
      </View>

      {unary ? null : (
        <>
          <Field label="Value" value={valueText} onChangeText={setValueText} placeholder={list ? 'checkout, payments' : 'value'} />
          {list ? <ThemedText type="caption">Separate several values with commas.</ThemedText> : null}
          {key && (values.data ?? []).length > 0 ? (
            <View style={styles.values}>
              {(values.data ?? []).slice(0, 24).map((v) => (
                <Chip key={v} label={v.length > 40 ? `${v.slice(0, 40)}…` : v} selected={valueText.trim() === v} onPress={() => setValueText(v)} />
              ))}
            </View>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

/** Picks one field to group by, with the same suggestions as the filter editor. */
export function GroupByEditor(props: { visible: boolean; signal: ExplorerSignal; range: TimeRange; onClose: () => void; onSubmit: (keys: string[]) => void }) {
  return props.visible ? <GroupByForm {...props} /> : null;
}

function GroupByForm({ signal, range, onClose, onSubmit }: { signal: ExplorerSignal; range: TimeRange; onClose: () => void; onSubmit: (keys: string[]) => void }) {
  const client = useClient();
  const theme = useTheme();
  const [key, setKey] = useState('');
  const debouncedKey = useDebounced(key);
  const windowKey = Math.floor(range.startMs / 60_000);
  const keys = useQuery({
    queryKey: ['field-keys', client.endpoint, signal, debouncedKey, windowKey],
    queryFn: ({ signal: abort }) => fetchFieldKeys(client, signal, debouncedKey, range, abort),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const ok = isValidKey(key.trim());
  return (
    <Sheet visible title="Group by" onClose={onClose} onApply={() => onSubmit([key.trim()])} canApply={ok}>
      <Field label="Field" value={key} onChangeText={setKey} placeholder="http.route" autoFocus />
      {key.trim() && !ok ? (
        <ThemedText type="caption" color="danger">
          A field name has letters, digits and . _ - : only.
        </ThemedText>
      ) : null}
      <View style={[styles.suggestions, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {(keys.data ?? []).slice(0, 14).map((k, i) => (
          <Pressable
            key={k.name}
            accessibilityRole="button"
            onPress={() => onSubmit([k.name])}
            style={[styles.suggestion, i > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
            <ThemedText type="small" style={styles.flex} numberOfLines={1}>
              {k.name}
            </ThemedText>
            <ThemedText type="caption">{[k.context, k.dataType].filter(Boolean).join(' · ')}</ThemedText>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/** The whole filter as text, for expressions the chips cannot build (OR, parentheses, functions). */
export function QueryEditor(props: { visible: boolean; signal: ExplorerSignal; onClose: () => void; onSubmit: (expression: string) => void }) {
  return props.visible ? <QueryForm {...props} /> : null;
}

function QueryForm({ signal, onClose, onSubmit }: { signal: ExplorerSignal; onClose: () => void; onSubmit: (expression: string) => void }) {
  const [text, setText] = useState(() => explorer.expression(signal));
  return (
    <Sheet visible title="Edit query" onClose={onClose} onApply={() => onSubmit(text.trim())} canApply>
      <Field label="Filter expression" value={text} onChangeText={setText} multiline autoFocus placeholder="service.name = 'api' AND http.status_code >= 500" />
      <ThemedText type="caption">SigNoz filter syntax. Clauses joined with AND become chips; anything else is kept as written.</ThemedText>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '600' },
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { minWidth: 64 },
  headerRight: { alignItems: 'flex-end' },
  body: { padding: Spacing.three, gap: Spacing.three },
  field: { gap: 6 },
  input: { fontSize: 16, paddingHorizontal: Spacing.three - 2, paddingVertical: 12, borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth },
  multiline: { minHeight: 120, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 14 },
  suggestions: { borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 12 },
  ops: { gap: Spacing.two },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
