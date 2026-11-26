import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FilterEditor, QueryEditor } from '@/components/filter-editor';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { explorer, useExplorer, type ExplorerSignal } from '@/lib/explorer-state';
import { addClause, clausesToExpression, describeClause, parseExpression, removeClause, replaceClause, type Clause } from '@/lib/filters';
import type { TimeRange } from '@/lib/signoz/queries';

interface FilterBarProps {
  signal: ExplorerSignal | 'metrics';
  /**
   * Keeps the filter in the caller instead of the shared explorer state, for a screen whose filter belongs to what it shows
   * (one metric) rather than to a tab. `metric` narrows field suggestions to that metric's labels.
   */
  local?: { clauses: Clause[]; onChange: (clauses: Clause[]) => void; metric?: string };
  /** The window the screen is looking at; autocomplete only offers fields and values seen in it. */
  range: TimeRange;
}

/** The active filters as removable chips, plus the entry points for adding one or editing the whole query. */
export function FilterBar({ signal, range, local }: FilterBarProps) {
  const theme = useTheme();
  const shared = useExplorer(signal === 'metrics' ? 'logs' : signal);
  const clauses = local ? local.clauses : shared.clauses;
  const store = {
    add: (clause: Clause) => (local ? local.onChange(addClause(local.clauses, clause)) : explorer.add(signal as ExplorerSignal, clause)),
    replace: (index: number, clause: Clause) => (local ? local.onChange(replaceClause(local.clauses, index, clause)) : explorer.replace(signal as ExplorerSignal, index, clause)),
    remove: (index: number) => (local ? local.onChange(removeClause(local.clauses, index)) : explorer.remove(signal as ExplorerSignal, index)),
    clear: () => (local ? local.onChange([]) : explorer.clear(signal as ExplorerSignal)),
    expression: () => clausesToExpression(clauses),
    setExpression: (expression: string) => (local ? local.onChange(parseExpression(expression)) : explorer.setExpression(signal as ExplorerSignal, expression, explorer.get(signal as ExplorerSignal).text)),
  };
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);

  // Android keeps the old scroll offset when the content gets shorter (removing a chip), leaving the row scrolled past its end and
  // showing nothing. Pull the offset back inside the new bounds.
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const viewport = useRef(0);

  return (
    <>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.row}
        scrollEventThrottle={16}
        onScroll={(e) => (offset.current = e.nativeEvent.contentOffset.x)}
        onLayout={(e) => (viewport.current = e.nativeEvent.layout.width)}
        onContentSizeChange={(width) => {
          const max = Math.max(0, width - viewport.current);
          if (offset.current > max) {
            offset.current = max;
            scroller.current?.scrollTo({ x: max, animated: false });
          }
        }}>
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
            onRemove={() => store.remove(i)}
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
          <Pressable accessibilityRole="button" onPress={store.clear} style={styles.link}>
            <ThemedText type="small" color="textSecondary" style={styles.bold}>
              Clear all
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>

      <FilterEditor
        visible={editing !== null}
        signal={signal}
        metric={local?.metric}
        range={range}
        initial={editing?.index != null ? clauses[editing.index] : undefined}
        onClose={() => setEditing(null)}
        onSubmit={(clause) => {
          if (editing?.index != null) store.replace(editing.index, clause);
          else store.add(clause);
          setEditing(null);
        }}
      />
      <QueryEditor
        visible={queryOpen}
        initial={store.expression()}
        onClose={() => setQueryOpen(false)}
        onSubmit={(expression) => {
          store.setExpression(expression);
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
