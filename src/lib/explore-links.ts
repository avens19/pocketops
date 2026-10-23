import { explorer, type ExplorerSignal } from './explorer-state';
import { quote } from './signoz/queries';

/** Route params that carry a filter into the logs or traces screen. `n` makes every navigation distinct so a repeat applies again. */
export type ExploreParams = {
  q?: string;
  service?: string;
  traceId?: string;
  /** Comma-separated fields to group traces by (from an explorer link). */
  groupBy?: string;
  last?: string;
  from?: string;
  to?: string;
  n?: string;
};

/** The filter expression a set of route params stands for. */
export function expressionFromParams(p: ExploreParams): string {
  const parts: string[] = [];
  if (p.q) parts.push(p.q);
  if (p.service) parts.push(`service.name = ${quote(p.service)}`);
  if (p.traceId) parts.push(`trace_id = ${quote(p.traceId)}`);
  return parts.join(' AND ');
}

export function hasExploreFilter(p: ExploreParams): boolean {
  return !!(p.q || p.service || p.traceId || p.groupBy);
}

export function exploreSignature(p: ExploreParams): string {
  return [p.q, p.service, p.traceId, p.groupBy, p.last, p.from, p.to, p.n].join('|');
}

/**
 * Applies route params to the explorer, once per distinct navigation, so coming back to a screen that still carries
 * old params does not undo the user's edits. The explorer remembers the signature; `paramsLanded` tells the screen when to query.
 */
export function applyRouteFilter(signal: ExplorerSignal, p: ExploreParams): void {
  if (!hasExploreFilter(p)) return;
  const sig = exploreSignature(p);
  if (explorer.get(signal).sig !== sig) {
    explorer.setExpression(signal, expressionFromParams(p), '', sig);
    if (signal === 'traces' && p.groupBy) explorer.setGroupBy('traces', p.groupBy.split(',').filter(Boolean));
  }
}

export function paramsLanded(signal: ExplorerSignal, p: ExploreParams): boolean {
  return !hasExploreFilter(p) || explorer.get(signal).sig === exploreSignature(p);
}

let counter = 0;
const nonce = () => `${Date.now()}-${counter++}`;

export function logsHref(p: Omit<ExploreParams, 'n'>) {
  return { pathname: '/logs' as const, params: { ...p, n: nonce() } };
}

export function tracesHref(p: Omit<ExploreParams, 'n'>) {
  return { pathname: '/traces' as const, params: { ...p, n: nonce() } };
}
