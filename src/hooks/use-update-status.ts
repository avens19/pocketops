import * as Updates from 'expo-updates';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { deriveUpdateStatus, type UpdateStatus } from '@/lib/update-status';

/** How long to give the restart before calling it a failure. The restart itself is immediate; this only bounds a hang. */
const RELOAD_DEADLINE_MS = 5_000;

/**
 * Floor between automatic rechecks once the app is running. A check fetches a small manifest, not the bundle, so one costs nothing,
 * but a phone flicking through the app switcher or a notification shade fires several `active` transitions in a row.
 */
const MIN_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

// Shared by every caller (the banner and Settings), so they cannot disagree about whether a check has completed: a per-component
// `useState` would let one say "checking…" after the other had resolved "up to date".
let started = false;
let lastCheckedAt = 0;
let hasChecked = false;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function runCheck(): Promise<void> {
  lastCheckedAt = Date.now();
  // The rejection is swallowed on purpose: a phone in poor signal fails this routinely. The failure still reaches the UI through
  // `useUpdates().checkError` and the `unknown` status; only the unhandled rejection is suppressed.
  return Updates.checkForUpdateAsync()
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      hasChecked = true;
      publish();
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getHasChecked = () => hasChecked;

/**
 * Starts the app's one update-check loop: once now, then on each return to the foreground (throttled). Called once from the root
 * layout, before sign-in matters, so a phone sitting on the connect screen picks up newer code like any other.
 *
 * Foregrounding matters because the app is meant to stay open for days. `checkAutomatically` only covers a cold launch, so without
 * this someone who never force-quits would never see an update. Nothing else should call it: a second loop would throttle itself
 * but not the first, doubling the rate the throttle exists to bound.
 *
 * Inert in a development build and in Expo Go, where every `expo-updates` call rejects.
 */
export function startUpdateChecks(): void {
  if (started || !Updates.isEnabled) return;
  started = true;
  void runCheck();
  AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active' || Date.now() - lastCheckedAt < MIN_RECHECK_INTERVAL_MS) return;
    void runCheck();
  });
}

/** Asks the update server again, ignoring the throttle. For the "Check again" button. */
export function checkForUpdateNow(): Promise<void> {
  return Updates.isEnabled ? runCheck() : Promise.resolve();
}

export function useUpdateStatus(): {
  status: UpdateStatus;
  /** Downloads the update if it is not already on the device, then restarts into it. */
  install: () => Promise<void>;
  /** An install is in flight: the button says so and refuses a second tap. */
  busy: boolean;
  /** The last install did not restart the app. Shown, because a button that silently does nothing looks broken. */
  failed: boolean;
} {
  const { isChecking, isDownloading, isUpdateAvailable, isUpdatePending, checkError } = Updates.useUpdates();
  const checked = useSyncExternalStore(subscribe, getHasChecked);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const status = deriveUpdateStatus({
    isEnabled: Updates.isEnabled,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdatePending,
    hasCheckError: Boolean(checkError),
    hasChecked: checked,
  });

  const install = useCallback(async () => {
    if (!Updates.isEnabled) return;
    setBusy(true);
    setFailed(false);
    try {
      // Skip the fetch when the bundle is already on the device: only the restart is left, and re-fetching would spend data to
      // arrive back where it started. No deadline on the fetch, since a bundle over weak signal is legitimately slow.
      if (status !== 'readyToRestart') await Updates.fetchUpdateAsync();

      // A restart is the one operation whose success cannot be observed from inside it: `reloadAsync` resolves just before the
      // restart is posted, so a resolved promise proves nothing. The only proof is that this code never runs again. So success is
      // made to look like silence (a resolution hangs), and everything else reaches the catch: a rejection as itself, a stall as
      // the deadline. Without the deadline, a `reloadAsync` queued behind a procedure that never completes would leave a dead button.
      await Promise.race([
        Updates.reloadAsync().then(() => new Promise<never>(() => {})),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('reloadAsync did not restart the app')), RELOAD_DEADLINE_MS);
        }),
      ]);
    } catch (err) {
      console.error('PocketOps: could not install the update', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [status]);

  return { status, install, busy, failed };
}
