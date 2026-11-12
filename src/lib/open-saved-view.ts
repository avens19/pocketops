import { router } from 'expo-router';

import { explorer } from './explorer-state';
import { asExplorerView } from './explorer-view';
import { exploreSignature, logsHref, tracesHref } from './explore-links';
import type { SavedView } from './signoz/views';

/** Restore the tab's real explorer and dismiss the saved-view picker/loader above it. */
export function openSavedExplorer(view: SavedView, rangeParams: { last?: string; from?: string; to?: string } = {}): boolean {
  const loaded = asExplorerView(view);
  if (!loaded) return false;
  const params = { ...rangeParams, q: loaded.expression, saved: view.id };
  const href = loaded.source === 'logs' ? logsHref(params) : tracesHref(params);
  explorer.loadView(view, loaded, exploreSignature(href.params));
  router.dismissTo(href);
  return true;
}
