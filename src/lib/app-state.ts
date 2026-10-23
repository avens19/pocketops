/**
 * Whether polling should run. Only an explicit `background` or `inactive` stops it: at launch, `AppState.currentState` can still be
 * `unknown` (or null) when the first screen renders, and no change event follows if the app was already in the foreground.
 */
export function isForeground(state: string | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}
