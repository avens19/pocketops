import { SignozError, type ErrorKind } from './signoz/client';

/**
 * Whether the app can currently talk to the server, judged from how queries end. Screens keep showing cached data when a
 * refresh fails, which looks healthy; this is what lets the UI say the data is stale and why.
 */
export interface ConnectionStatus {
  failing: boolean;
  kind?: ErrorKind;
  /** When a request last succeeded, for "last updated". */
  lastOkAt: number | null;
}

export const OK: ConnectionStatus = { failing: false, lastOkAt: null };

/** Errors that mean "the server is unreachable or unwell" rather than "this endpoint does not exist" (a version probe). */
const CONNECTION_KINDS: ErrorKind[] = ['network', 'server', 'auth'];

/** Pure transition: a query succeeded, or failed with `error`. Aborted requests and 404-style probes change nothing. */
export function nextStatus(status: ConnectionStatus, outcome: { type: 'success' } | { type: 'error'; error: unknown }, now: number): ConnectionStatus {
  if (outcome.type === 'success') return status.failing || status.lastOkAt === null || now - status.lastOkAt > 1000 ? { failing: false, lastOkAt: now } : status;
  const e = outcome.error;
  if (e instanceof Error && e.name === 'AbortError') return status;
  if (!(e instanceof SignozError) || !CONNECTION_KINDS.includes(e.kind)) return status;
  return status.failing && status.kind === e.kind ? status : { ...status, failing: true, kind: e.kind };
}
