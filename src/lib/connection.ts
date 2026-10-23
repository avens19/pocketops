import { useSyncExternalStore } from 'react';

import { OK, isRecoverable, nextStatus, type ConnectionStatus } from './connection-status';
import { queryClient } from './query';

export type { ConnectionStatus };

let status = OK;
const listeners = new Set<() => void>();

function set(next: ConnectionStatus) {
  if (next === status) return;
  status = next;
  listeners.forEach((l) => l());
}

export function resetConnection() {
  set(OK);
}

/** Starts watching every query's outcome. Call once for the life of the app. */
export function watchConnection(): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const action = event.action;
    if (action.type === 'success') {
      const wasFailing = status.failing;
      set(nextStatus(status, { type: 'success' }, Date.now()));
      // Back online: screens that gave up while it was down would sit on their error until tapped. Retry the ones on screen whose
      // failure a retry can fix, once; stale or permanently failing queries (a bad filter) stay as they are.
      if (wasFailing && !status.failing) void queryClient.refetchQueries({ predicate: (q) => q.getObserversCount() > 0 && q.state.status === 'error' && isRecoverable(q.state.error) });
    } else if (action.type === 'error') set(nextStatus(status, { type: 'error', error: action.error }, Date.now()));
  });
}

export function useConnection(): ConnectionStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => status,
    () => OK,
  );
}

/** Refetch everything on screen, as "Retry" on the banner. */
export function retryConnection() {
  void queryClient.refetchQueries({ type: 'active' });
}
