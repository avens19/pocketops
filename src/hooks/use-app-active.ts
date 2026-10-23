import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { isForeground } from '@/lib/app-state';

function subscribe(onChange: () => void) {
  const sub = AppState.addEventListener('change', onChange);
  return () => sub.remove();
}

/** True while the app is in the foreground. Polling that nobody can see should stop when it is not. */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, () => isForeground(AppState.currentState), () => true);
}
