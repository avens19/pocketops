import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Chip } from './chip';
import { Field, Sheet } from './filter-editor';
import { ErrorState, Loading } from './query-state';
import { ThemedText } from './themed-text';
import { useDebounced } from '@/hooks/use-debounced';
import { useClient } from '@/lib/auth';
import { variableOptions, type DashboardVariable, type VariableValue } from '@/lib/signoz/dashboards';
import type { TimeRange } from '@/lib/signoz/queries';

export function DashboardVariablePicker({ variable, initial, range, onClose, onApply }: { variable: DashboardVariable; initial: VariableValue; range: TimeRange; onClose: () => void; onApply: (value: VariableValue) => void }) {
  const client = useClient();
  const [value, setValue] = useState(initial.value);
  const [search, setSearch] = useState('');
  const searchTerm = useDebounced(search);
  const v = variable.spec;
  const isText = variable.kind === 'TextVariable';
  const options = useQuery({ queryKey: ['dashboard-variable', client.endpoint, variable, range, searchTerm], enabled: !isText,
    queryFn: ({ signal }) => variableOptions(client, variable, range, searchTerm, signal), staleTime: 60_000 });
  const selected = Array.isArray(value) ? value : value === '__all__' ? [] : [value];
  const choices = [...new Set([...selected.filter(Boolean), ...(options.data ?? [])])];
  return <Sheet visible title={v.display?.name || v.name} onClose={onClose} onApply={() => onApply({ ...initial, value })} canApply={value !== '' && (!Array.isArray(value) || value.length > 0)}>
    {v.display?.description ? <ThemedText type="caption">{v.display.description}</ThemedText> : null}
    {isText ? <Field label="Value" value={String(value)} onChangeText={setValue} /> : <>
      <Field label="Find a value" value={search} onChangeText={setSearch} />
      {v.allowAllValue && initial.type === 'dynamic' ? <Chip label="All" selected={value === '__all__'} onPress={() => setValue('__all__')} /> : null}
      {v.allowMultiple && initial.type === 'custom' && !search && options.data?.length ? <Chip label="Select all" onPress={() => setValue(options.data!)} /> : null}
      <View style={{ gap: 8 }}>{choices.map((option) => <Chip key={option} label={option} selected={selected.includes(option)} onPress={() => {
        setValue(v.allowMultiple ? selected.includes(option) ? selected.filter((x) => x !== option) : [...selected, option] : option);
      }} />)}</View>
      {options.isPending ? <Loading /> : options.isError ? <ErrorState error={options.error} onRetry={() => void options.refetch()} /> : !choices.length ? <ThemedText type="caption">No values in this time range.</ThemedText> : null}
      {(options.data?.length ?? 0) >= 200 ? <ThemedText type="caption">Showing up to 200 values. Search to find more.</ThemedText> : null}
    </>}
  </Sheet>;
}
