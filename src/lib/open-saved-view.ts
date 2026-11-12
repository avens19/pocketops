import { router } from 'expo-router';

import { isMetricExplorerView } from './metric-view';
import { explorer } from './explorer-state';
import { asExplorerView } from './explorer-view';
import { exploreSignature, logsHref, tracesHref } from './explore-links';
import type { SavedView } from './signoz/views';

/** Restore the tab's real explorer and dismiss the saved-view picker/loader above it. */
export function openSavedExplorer(view: SavedView, rangeParams: { last?: string; from?: string; to?: string } = {}): boolean {
  if (isMetricExplorerView(view)) {
    router.dismissTo({ pathname: '/metrics', params: { prefix: undefined, last: undefined, from: undefined, to: undefined, ...rangeParams, saved: view.id, n: `${Date.now()}-${view.id}` } });
    return true;
  }
  const loaded = asExplorerView(view);
  if (!loaded) return false;
  const params = { service: undefined, traceId: undefined, groupBy: undefined, op: undefined, last: undefined, from: undefined, to: undefined, ...rangeParams, q: loaded.expression, saved: view.id };
  const href = loaded.source === 'logs' ? logsHref(params) : tracesHref(params);
  explorer.loadView(view, loaded, exploreSignature(href.params));
  router.dismissTo(href);
  return true;
}
