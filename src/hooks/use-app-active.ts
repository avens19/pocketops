import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** True while the app is in the foreground. Polling that nobody can see should stop when it is not. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => setActive(status === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
