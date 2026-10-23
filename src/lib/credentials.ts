import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Credentials } from '@/lib/signoz/client';

const ENDPOINT_KEY = 'signoz.endpoint';
const API_KEY_KEY = 'signoz.apiKey';

// The key unlocks read access to production telemetry, so it stays on this device only: no iCloud
// Keychain sync, and not readable while the phone is locked.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// SecureStore has no web implementation. The web build exists only for development (browser preview), so it
// falls back to localStorage; native builds never take this path.
const isWeb = Platform.OS === 'web';
const read = async (key: string) => (isWeb ? globalThis.localStorage?.getItem(key) ?? null : SecureStore.getItemAsync(key, OPTIONS));
const write = async (key: string, value: string) => {
  if (isWeb) globalThis.localStorage?.setItem(key, value);
  else await SecureStore.setItemAsync(key, value, OPTIONS);
};
const remove = async (key: string) => {
  if (isWeb) globalThis.localStorage?.removeItem(key);
  else await SecureStore.deleteItemAsync(key, OPTIONS);
};

export async function loadCredentials(): Promise<Credentials | null> {
  const [endpoint, apiKey] = await Promise.all([read(ENDPOINT_KEY), read(API_KEY_KEY)]);
  return endpoint && apiKey ? { endpoint, apiKey } : null;
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await write(ENDPOINT_KEY, credentials.endpoint);
  await write(API_KEY_KEY, credentials.apiKey);
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([remove(ENDPOINT_KEY), remove(API_KEY_KEY)]);
}
