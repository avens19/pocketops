import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { SignozError } from '@/lib/signoz/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // A rejected key or a missing endpoint will not fix itself on retry.
      retry: (count, error) =>
        count < 2 && !(error instanceof SignozError && ['auth', 'forbidden', 'not-found', 'bad-request'].includes(error.kind)),
    },
  },
});

/** React Query's default focus detection is browser-only; tie it to the app coming to the foreground. */
export function setupFocusManager() {
  const sub = AppState.addEventListener('change', (status) => {
    if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
  });
  return () => sub.remove();
}
