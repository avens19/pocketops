import * as SecureStore from 'expo-secure-store';

import type { Credentials } from '@/lib/signoz/client';

const ENDPOINT_KEY = 'signoz.endpoint';
const API_KEY_KEY = 'signoz.apiKey';

// The key unlocks read access to production telemetry, so it stays on this device only: no iCloud
// Keychain sync, and not readable while the phone is locked.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function loadCredentials(): Promise<Credentials | null> {
  const [endpoint, apiKey] = await Promise.all([
    SecureStore.getItemAsync(ENDPOINT_KEY, OPTIONS),
    SecureStore.getItemAsync(API_KEY_KEY, OPTIONS),
  ]);
  return endpoint && apiKey ? { endpoint, apiKey } : null;
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await SecureStore.setItemAsync(ENDPOINT_KEY, credentials.endpoint, OPTIONS);
  await SecureStore.setItemAsync(API_KEY_KEY, credentials.apiKey, OPTIONS);
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ENDPOINT_KEY, OPTIONS),
    SecureStore.deleteItemAsync(API_KEY_KEY, OPTIONS),
  ]);
}
