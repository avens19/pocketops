import { useSyncExternalStore } from 'react';

import { OK, nextStatus, type ConnectionStatus } from './connection-status';
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
    if (action.type === 'success') set(nextStatus(status, { type: 'success' }, Date.now()));
    else if (action.type === 'error') set(nextStatus(status, { type: 'error', error: action.error }, Date.now()));
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
