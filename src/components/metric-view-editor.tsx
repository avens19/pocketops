import { useState } from 'react';
import { View } from 'react-native';
import { Chip } from './chip';
import { Field, Sheet } from './filter-editor';
import { ThemedText } from './themed-text';
import { updateMetricQuery, validateMetricSpec, type MetricAggregation } from '@/lib/metric-view';
import type { ViewSpec } from '@/lib/signoz/views';

export function MetricViewEditor({ initial, onClose, onApply }: { initial: ViewSpec; onClose: () => void; onApply: (spec: ViewSpec) => void }) {
  const [spec, setSpec] = useState(initial);
  const [error, setError] = useState('');
  const patch = (index: number, change: Record<string, unknown>) => setSpec((s) => updateMetricQuery(s, index, change));
  return <Sheet visible title="Configure metric queries" onClose={onClose} canApply onApply={() => {
    try { validateMetricSpec(spec); onApply(spec); } catch (e) { setError((e as Error).message); }
  }}>
    {spec.queries.map((query, index) => <View key={index} style={{ gap: 10, marginBottom: 18 }}>
      <ThemedText type="heading">{String(query.spec.name)} · {query.type === 'builder_formula' ? 'Formula' : 'Metric'}</ThemedText>
      <Chip label={query.spec.disabled ? 'Output hidden' : 'Output shown'} selected={!query.spec.disabled} onPress={() => patch(index, { disabled: !query.spec.disabled })} />
      {query.type === 'builder_formula' ? <>
        <Field label="Formula" value={String(query.spec.expression ?? '')} onChangeText={(expression) => patch(index, { expression })} placeholder="A / B * 100" />
        <ThemedText type="caption">Hidden input queries still participate in formulas.</ThemedText>
      </> : <>
        {((query.spec.aggregations ?? []) as MetricAggregation[]).map((agg, i, all) => {
          const update = (change: Partial<MetricAggregation>) => patch(index, { aggregations: all.map((a, n) => n === i ? { ...a, ...change } : a) });
          return <View key={i} style={{ gap: 8 }}>
            <Field label={`Metric ${i + 1}`} value={agg.metricName} onChangeText={(metricName) => update({ metricName })} />
            <Field label="Time aggregation" value={agg.timeAggregation ?? ''} onChangeText={(timeAggregation) => update({ timeAggregation })} placeholder="rate, avg, max, increase…" />
            <Field label="Space aggregation" value={agg.spaceAggregation ?? ''} onChangeText={(spaceAggregation) => update({ spaceAggregation })} placeholder="sum, avg, max, p95…" />
            <Field label="Scalar reduction" value={agg.reduceTo ?? ''} onChangeText={(reduceTo) => update({ reduceTo })} placeholder="avg, sum, last…" />
          </View>;
        })}
        <Field label="Filter" multiline value={String((query.spec.filter as { expression?: string } | undefined)?.expression ?? '')} onChangeText={(expression) => patch(index, { filter: { ...(query.spec.filter as object | undefined), expression } })} />
        <Field label="Group by" defaultValue={((query.spec.groupBy ?? []) as { name: string }[]).map((g) => g.name).join(', ')} onChangeText={(value) => {
          // Preserve field metadata while allowing unfinished text; validate all keys when applying.
          patch(index, { groupBy: value.split(',').map((name) => name.trim()).filter(Boolean).map((name) => ((initial.queries[index].spec.groupBy ?? []) as { name: string }[]).find((g) => g.name === name) ?? { name }) });
        }} />
      </>}
      <Field label="Legend" value={String(query.spec.legend ?? '')} onChangeText={(legend) => patch(index, { legend })} placeholder="{{service.name}}" />
      <Field label="Group limit" value={query.spec.limit == null ? '' : String(query.spec.limit)} onChangeText={(value) => patch(index, { limit: value.trim() ? Number(value) : undefined })} keyboardType="number-pad" />
      <ThemedText type="caption">Existing sort order, functions, and other options are preserved. Use Advanced for those settings.</ThemedText>
    </View>)}
    <ThemedText type="caption">Apply previews your changes. Update view saves them to SigNoz.</ThemedText>
    {error ? <ThemedText color="danger">{error}</ThemedText> : null}
  </Sheet>;
}
