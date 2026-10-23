import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FilterEditor, QueryEditor } from '@/components/filter-editor';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { explorer, useExplorer, type ExplorerSignal } from '@/lib/explorer-state';
import { describeClause, type Clause } from '@/lib/filters';
import type { TimeRange } from '@/lib/signoz/queries';

interface FilterBarProps {
  signal: ExplorerSignal;
  /** The window the screen is looking at; autocomplete only offers fields and values seen in it. */
  range: TimeRange;
}

/** The active filters as removable chips, plus the entry points for adding one or editing the whole query. */
export function FilterBar({ signal, range }: FilterBarProps) {
  const theme = useTheme();
  const { clauses } = useExplorer(signal);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add filter"
          onPress={() => setEditing({ index: null })}
          style={[styles.add, { borderColor: theme.accent }]}>
          <ThemedText type="small" color="accent" style={styles.bold}>
            ＋ Filter
          </ThemedText>
        </Pressable>
        {clauses.map((clause, i) => (
          <FilterChip
            key={`${i}-${describeClause(clause).key}-${describeClause(clause).value}`}
            clause={clause}
            onPress={() => setEditing({ index: i })}
            onRemove={() => explorer.remove(signal, i)}
          />
        ))}
        {clauses.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setQueryOpen(true)} style={styles.link}>
            <ThemedText type="small" color="textSecondary" style={styles.bold}>
              Edit query
            </ThemedText>
          </Pressable>
        ) : null}
        {clauses.length > 1 ? (
          <Pressable accessibilityRole="button" onPress={() => explorer.clear(signal)} style={styles.link}>
            <ThemedText type="small" color="textSecondary" style={styles.bold}>
              Clear all
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>

      <FilterEditor
        visible={editing !== null}
        signal={signal}
        range={range}
        initial={editing?.index != null ? clauses[editing.index] : undefined}
        onClose={() => setEditing(null)}
        onSubmit={(clause) => {
          if (editing?.index != null) explorer.replace(signal, editing.index, clause);
          else explorer.add(signal, clause);
          setEditing(null);
        }}
      />
      <QueryEditor
        visible={queryOpen}
        signal={signal}
        onClose={() => setQueryOpen(false)}
        onSubmit={(expression) => {
          explorer.setExpression(signal, expression, explorer.get(signal).text);
          setQueryOpen(false);
        }}
      />
    </>
  );
}

function FilterChip({ clause, onPress, onRemove }: { clause: Clause; onPress: () => void; onRemove: () => void }) {
  const theme = useTheme();
  const d = describeClause(clause);
  const negative = clause.kind === 'filter' && ['!=', 'NOT CONTAINS', 'NOT IN', 'NOT EXISTS'].includes(clause.op);
  return (
    <View style={[styles.chip, { backgroundColor: theme.card, borderColor: negative ? theme.danger : theme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit filter ${d.key} ${d.op} ${d.value}`} onPress={onPress} style={styles.chipBody}>
        {d.key ? (
          <ThemedText type="small" color="textSecondary" numberOfLines={1}>
            {d.key}{' '}
          </ThemedText>
        ) : null}
        {d.op ? (
          <ThemedText type="small" color={negative ? 'danger' : 'textSecondary'} numberOfLines={1}>
            {d.op}{' '}
          </ThemedText>
        ) : null}
        <ThemedText type="small" numberOfLines={1} style={[styles.bold, styles.value]}>
          {d.value}
        </ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove filter ${d.key} ${d.value}`} hitSlop={8} onPress={onRemove} style={styles.remove}>
        <ThemedText type="small" color="textSecondary">
          ✕
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, alignItems: 'center' },
  bold: { fontWeight: '600' },
  add: { paddingHorizontal: Spacing.three - 2, paddingVertical: 6, borderRadius: Radius.pill, borderWidth: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.pill, borderWidth: 1, maxWidth: 280 },
  chipBody: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.three - 2, paddingVertical: 6, flexShrink: 1 },
  value: { flexShrink: 1 },
  remove: { paddingHorizontal: Spacing.two + 2, paddingVertical: 6 },
  link: { paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
