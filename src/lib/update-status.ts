/**
 * Whether this phone is running the newest code, in words a person can act on.
 *
 * The version in Settings is read out of the binary, and an EAS Update cannot move it: an update replaces the JavaScript inside an
 * installed binary while the native version is compiled in. `runtimeVersion.policy` is `appVersion`, so bumping the version is exactly
 * what forces a new build. The version can never mean "you have the newest code", so the question is put to the update server instead.
 *
 * `expo-updates` reports the pieces (`isChecking`, `isUpdateAvailable`, `isUpdatePending`, `checkError`) but not the answer. Turning
 * those booleans into one thing to say is the part worth getting right, so it is a pure function here, free of the `expo-updates`
 * import, and runs under vitest without the native module.
 */

export type UpdateStatus =
  /** Development build or Expo Go: `expo-updates` is inert and has nothing true to say. */
  | 'unsupported'
  | 'checking'
  | 'upToDate'
  /** A newer update exists on the server and has not been downloaded. */
  | 'available'
  | 'downloading'
  /** Downloaded and waiting for a restart to take effect. */
  | 'readyToRestart'
  /** The check did not complete. Being offline is the ordinary reason. */
  | 'unknown';

export interface UpdateSignals {
  /** `Updates.isEnabled`: false in a development build and in Expo Go. */
  isEnabled: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  /** `useUpdates().checkError` was set. */
  hasCheckError: boolean;
  /** A check has completed at least once this session. */
  hasChecked: boolean;
}

/**
 * The single status to show.
 *
 * Order matters and is not the order the fields are declared in: `isUpdateAvailable` stays true after a download finishes, so
 * "downloaded, waiting for a restart" is tested before "an update is available", or the app would keep offering to download something
 * it already has. A failed check reports `unknown`, never `upToDate`: for a monitoring app that is opened in bad signal, claiming
 * currency when nothing was reached is the one answer that would be false, and false in the direction that stops people looking.
 */
export function deriveUpdateStatus(signals: UpdateSignals): UpdateStatus {
  if (!signals.isEnabled) return 'unsupported';
  if (signals.isUpdatePending) return 'readyToRestart';
  if (signals.isDownloading) return 'downloading';
  if (signals.isChecking) return 'checking';
  if (signals.isUpdateAvailable) return 'available';
  if (signals.hasCheckError) return 'unknown';
  return signals.hasChecked ? 'upToDate' : 'checking';
}

/** What to say for a status, or null when there is nothing worth saying (a development build has no channel to be behind). */
export function updateMessage(status: UpdateStatus): string | null {
  switch (status) {
    case 'unsupported':
      return null;
    case 'checking':
      return 'Checking for updates…';
    case 'upToDate':
      return 'Up to date';
    case 'available':
      return 'An update is available';
    case 'downloading':
      return 'Downloading update…';
    case 'readyToRestart':
      return 'Update ready. Restart to finish.';
    case 'unknown':
      return 'Could not check for updates';
  }
}

export type UpdateAction = 'check' | 'download' | 'restart';

/**
 * The button to offer, or null where pressing would do nothing. A manual check is offered once a check has finished either way, so
 * someone who has just been told "Up to date" or "Could not check" can ask again instead of having to relaunch the app.
 */
export function updateAction(status: UpdateStatus): UpdateAction | null {
  switch (status) {
    case 'available':
      return 'download';
    case 'readyToRestart':
      return 'restart';
    case 'upToDate':
    case 'unknown':
      return 'check';
    default:
      return null;
  }
}

export const UPDATE_ACTION_LABEL: Record<UpdateAction, string> = {
  check: 'Check again',
  download: 'Download',
  restart: 'Restart',
};

export const UPDATE_INSTALL_FAILED = 'Could not restart. Close the app and open it again to finish.';
