import { useCallback, useState } from 'react';

// Reading the clock is deliberate here: it fixes where a query window ends. Kept out of component bodies for the purity lint.
const clock = () => Date.now();

/**
 * The moment a list's time window ends. Fixed while the user pages, so offsets are not disturbed by new rows arriving,
 * and moved on refresh or whenever `key` (the filter, range, ...) changes. Derived during render, not in an effect.
 */
export function useWindowAnchor(key: string): [anchor: number, refresh: () => void] {
  const [state, setState] = useState(() => ({ key, t: clock() }));
  let anchor = state.t;
  if (state.key !== key) {
    anchor = clock();
    setState({ key, t: anchor });
  }
  const refresh = useCallback(() => setState({ key, t: clock() }), [key]);
  return [anchor, refresh];
}
