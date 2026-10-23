import { useSyncExternalStore } from 'react';

import { addClause, clausesToExpression, parseExpression, removeClause, replaceClause, type Clause } from './filters';

/**
 * The filter each explorer (logs, traces) is showing, kept outside the screens so a detail screen can add a filter
 * ("only show this service") and the list it returns to already has it, and so a filter survives switching tabs.
 */
export type ExplorerSignal = 'logs' | 'traces';

export interface ExplorerState {
  clauses: Clause[];
  /** Free text searched in the log body / span name, separate from the attribute filters. */
  text: string;
  /** Signature of the route navigation that last set this filter, so a screen knows its params have landed. */
  sig: string;
  /** Traces only: list one row per trace (root spans) rather than every span. */
  rootOnly: boolean;
  /** Traces only: keep spans with an error. */
  errorsOnly: boolean;
  /** Traces only: show counts per value of these fields instead of the span list. */
  groupBy: string[];
}

const EMPTY: ExplorerState = { clauses: [], text: '', sig: '', rootOnly: true, errorsOnly: false, groupBy: [] };

const states: Record<ExplorerSignal, ExplorerState> = { logs: EMPTY, traces: EMPTY };
const listeners = new Set<() => void>();

function set(signal: ExplorerSignal, next: ExplorerState) {
  states[signal] = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const explorer = {
  get: (signal: ExplorerSignal) => states[signal],
  add: (signal: ExplorerSignal, clause: Clause) => {
    const s = states[signal];
    const clauses = addClause(s.clauses, clause);
    if (clauses !== s.clauses) set(signal, { ...s, clauses });
  },
  /**
   * Adds a clause because the user is looking into something specific (a tapped attribute). The attribute may live on a child span,
   * so the traces list stops being limited to root spans, or the target would come back empty.
   */
  investigate: (signal: ExplorerSignal, clause: Clause) => {
    const s = states[signal];
    // Drilling into a group leaves group-by, so the matching spans are what you see next.
    set(signal, { ...s, clauses: addClause(s.clauses, clause), rootOnly: signal === 'traces' ? false : s.rootOnly, groupBy: [] });
  },
  setRootOnly: (signal: ExplorerSignal, rootOnly: boolean) => set(signal, { ...states[signal], rootOnly }),
  setErrorsOnly: (signal: ExplorerSignal, errorsOnly: boolean) => set(signal, { ...states[signal], errorsOnly }),
  setGroupBy: (signal: ExplorerSignal, groupBy: string[]) => set(signal, { ...states[signal], groupBy }),
  remove: (signal: ExplorerSignal, index: number) => {
    const s = states[signal];
    set(signal, { ...s, clauses: removeClause(s.clauses, index) });
  },
  replace: (signal: ExplorerSignal, index: number, clause: Clause) => {
    const s = states[signal];
    set(signal, { ...s, clauses: replaceClause(s.clauses, index, clause) });
  },
  setText: (signal: ExplorerSignal, text: string) => {
    const s = states[signal];
    if (s.text !== text) set(signal, { ...s, text });
  },
  /** Replaces the filter from a raw expression, as when a pasted SigNoz link or "view logs for this alert" arrives. */
  setExpression: (signal: ExplorerSignal, expression: string, text = '', sig?: string) => {
    const s = states[signal];
    // A query that arrives from elsewhere (a link, an alert, a service) is about specific spans: show them all, not just roots.
    set(signal, { ...s, clauses: parseExpression(expression), text, sig: sig ?? s.sig, rootOnly: expression.trim() ? false : s.rootOnly, errorsOnly: false, groupBy: [] });
  },
  clear: (signal: ExplorerSignal) => set(signal, { ...states[signal], clauses: [], text: '' }),
  expression: (signal: ExplorerSignal) => clausesToExpression(states[signal].clauses),
};

export function useExplorer(signal: ExplorerSignal): ExplorerState {
  return useSyncExternalStore(subscribe, () => states[signal], () => EMPTY);
}
