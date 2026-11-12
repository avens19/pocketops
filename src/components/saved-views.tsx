import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from './chip';
import { Field, Sheet } from './filter-editor';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { useViewPermission } from '@/hooks/use-view-permission';
import { SignozError } from '@/lib/signoz/client';
import { viewPermissionKey, type ViewPermission } from '@/lib/signoz/permissions';
import { explorer, useExplorer, type ExplorerSignal } from '@/lib/explorer-state';
import { mergeExplorerView } from '@/lib/explorer-view';
import { exploreSignature, type ExploreParams } from '@/lib/explore-links';
import { openSavedExplorer } from '@/lib/open-saved-view';
import { useClient } from '@/lib/auth';
import { RANGES, type RangeSpec } from '@/lib/signoz/queries';
import { saveView, validateViewSpec, withViewFilter, type SavedView, type ViewSource, type ViewSpec } from '@/lib/signoz/views';

type SavedViewsBarProps = { source: ViewSource; spec?: ViewSpec; range?: RangeSpec };

export function SavedViewsBar(props: SavedViewsBarProps) {
  return props.source === 'metrics' ? <MetricSavedViewsBar {...props} /> : <ExplorerSavedViewsBar {...props} source={props.source} />;
}

function ExplorerSavedViewsBar({ source, spec, range }: SavedViewsBarProps & { source: ExplorerSignal }) {
  const create = useViewPermission({ action: 'create' });
  const { saved, aggregateReturn } = useExplorer(source);
  const params = useLocalSearchParams<ExploreParams>();
  const [draft, setDraft] = useState<{ spec: ViewSpec; baseline: ViewSpec; id?: string }>();
  const current = spec && saved ? mergeExplorerView(saved.view, saved.baseline, spec) : spec;
  const dirty = !!saved && current !== saved.view.spec;
  return <View style={{ gap: Spacing.two }}>
    {saved ? <ThemedText type="small">{saved.view.spec.displayName}{dirty ? ' · Unsaved changes' : ''}</ThemedText> : null}
    <View style={styles.row}>
      {aggregateReturn ? <Chip label={aggregateReturn.aggregate?.panelType === 'graph' ? 'Back to chart' : 'Back to table'} onPress={() => { const next = viewRangeParams(range); explorer.stageRoute(source, exploreSignature({ ...params, ...next })); router.setParams(next); explorer.restoreAggregate(source); }} /> : null}
      <Chip label="Saved views" onPress={() => router.push({ pathname: '/views', params: { source, ...viewRangeParams(range) } })} />
      {current && spec && create.allowed ? <Chip label={saved ? 'Save a copy' : 'Save view'} onPress={() => setDraft({ spec: current, baseline: spec })} /> : null}
      {saved && current && spec ? <UpdateViewChip id={saved.view.id} onPress={() => setDraft({ spec: current, baseline: spec, id: saved.view.id })} /> : null}
      {dirty && saved ? <Chip label="Discard changes" onPress={() => openSavedExplorer(saved.view, viewRangeParams(range))} /> : null}
      {saved ? <Chip label="Leave view" onPress={() => explorer.detachView(source)} /> : null}
    </View>
    {draft ? <SaveViewForm source={source} initial={draft.spec} id={draft.id} onClose={() => setDraft(undefined)} onSaved={(id, savedSpec) => {
      const view: SavedView = { ...(saved?.view.id === id ? saved.view : {}), id, source, schemaVersion: 'v2', spec: savedSpec };
      explorer.attachView(source, view, draft.baseline);
      setDraft(undefined);
    }} /> : null}
  </View>;
}

function UpdateViewChip({ id, onPress }: { id: string; onPress: () => void }) {
  const update = useViewPermission({ action: 'update', id });
  return update.allowed ? <Chip label="Update view" onPress={onPress} /> : null;
}

function MetricSavedViewsBar({ source, spec, range }: SavedViewsBarProps) {
  const create = useViewPermission({ action: 'create' });
  const [draft, setDraft] = useState<ViewSpec>();
  return (
    <View style={styles.row}>
      <Chip label="Saved views" onPress={() => router.push({ pathname: '/views', params: { source, ...viewRangeParams(range) } })} />
      {spec && create.allowed ? <Chip label="Save view" onPress={() => setDraft(spec)} /> : null}
      {draft ? <SaveViewForm source={source} initial={draft} onClose={() => setDraft(undefined)} onSaved={(id) => {
        setDraft(undefined);
        router.push({ pathname: '/views/[id]', params: { id, ...viewRangeParams(range) } });
      }} /> : null}
    </View>
  );
}

export function SaveViewForm({ source, initial, id, onClose, onSaved }: {
  source: ViewSource; initial: ViewSpec; id?: string; onClose: () => void; onSaved: (id: string, spec: ViewSpec) => void;
}) {
  const client = useClient();
  const cache = useQueryClient();
  const permission: ViewPermission = id ? { action: 'update', id } : { action: 'create' };
  const access = useViewPermission(permission);
  const [spec, setSpec] = useState(initial);
  const mutation = useMutation({
    mutationFn: () => {
      if (!access.allowed) throw new Error('Save permission has not been confirmed.');
      return saveView(client, source, spec, id);
    },
    onError: (error) => {
      if (error instanceof SignozError && error.kind === 'forbidden') {
        // A revoked permission immediately hides this action everywhere sharing the cached decision.
        void cache.cancelQueries({ queryKey: viewPermissionKey(client.endpoint, permission) }).then(() => {
          cache.setQueryData(viewPermissionKey(client.endpoint, permission), false);
        });
      }
    },
    onSuccess: (savedId) => {
      void cache.invalidateQueries({ queryKey: ['saved-views', client.endpoint] });
      void cache.invalidateQueries({ queryKey: ['saved-view', client.endpoint, savedId] });
      onSaved(savedId, spec);
    },
  });
  return (
    <Sheet visible title={id ? 'Update view' : 'Save view'} applyLabel={id ? 'Update' : 'Save'} onClose={() => { if (!mutation.isPending) onClose(); }}
      onApply={() => { if (access.allowed && !mutation.isPending) mutation.mutate(); }} canApply={access.allowed && !!spec.displayName.trim() && !mutation.isPending}>
      <Field label="Name" accessibilityLabel="View name" value={spec.displayName} onChangeText={(displayName) => setSpec({ ...spec, displayName })} editable={!mutation.isPending} autoFocus />
      <ThemedText type="small" color="textSecondary">{id ? 'Replaces this shared view in SigNoz.' : 'Saves a shared view in SigNoz.'} The time range stays in your current session.</ThemedText>
      {!access.allowed ? <ThemedText type="small" color="textSecondary">{access.isPending ? 'Checking save permission…' : access.isError ? 'Could not verify save permission.' : 'This key does not have permission to save this view.'}</ThemedText> : null}
      {access.isError ? <Chip label="Retry permission check" onPress={() => void access.refetch()} /> : null}
      {mutation.isPending ? <ThemedText>Saving…</ThemedText> : null}
      {mutation.isError ? <ThemedText color="danger">{mutation.error.message}</ThemedText> : null}
    </Sheet>
  );
}

/** Work on a local draft; nothing reaches SigNoz until the user saves it. */
export function EditViewForm({ initial, onClose, onApply }: { initial: ViewSpec; onClose: () => void; onApply: (spec: ViewSpec) => void }) {
  const [spec, setSpec] = useState(initial);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  function apply() {
    try {
      const next: unknown = advanced ? JSON.parse(json) : spec;
      validateViewSpec(next);
      onApply(next);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <Sheet visible title="Edit view" onClose={onClose} onApply={apply} canApply>
      {advanced ? <Field label="View specification (JSON)" accessibilityLabel="View specification JSON" value={json} onChangeText={setJson} multiline style={{ minHeight: 320 }} /> : <>
        <Field label="Name" value={spec.displayName} onChangeText={(displayName) => setSpec({ ...spec, displayName })} />
        {spec.queries.map((query, index) => query.type === 'builder_query' ? (
          <Field key={index} label={`Query ${String(query.spec.name ?? index + 1)} filter`} multiline
            value={String((query.spec.filter as { expression?: string } | undefined)?.expression ?? '')}
            onChangeText={(expression) => setSpec(withViewFilter(spec, index, expression))} />
        ) : <ThemedText key={index} type="small">Query {String(query.spec.name ?? index + 1)}: {query.type}. Use advanced editing to change this query.</ThemedText>)}
        <Chip label="Advanced: edit full query" onPress={() => { setJson(JSON.stringify(spec, null, 2)); setAdvanced(true); }} />
      </>}
      <ThemedText type="caption">Apply previews your changes locally. Saving to SigNoz is available when your key has permission.</ThemedText>
      {error ? <ThemedText color="danger">{error}</ThemedText> : null}
    </Sheet>
  );
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two } });

export function viewRangeParams(range?: RangeSpec) {
  if (!range) return {};
  if ('startMs' in range) return { last: undefined, from: String(range.startMs), to: String(range.endMs) };
  return { from: undefined, to: undefined, last: String('key' in range ? RANGES.find((r) => r.key === range.key)!.ms : range.lastMs) };
}
