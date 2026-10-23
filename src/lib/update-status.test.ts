import { describe, expect, it } from 'vitest';

import { deriveUpdateStatus, updateAction, updateMessage, type UpdateSignals } from './update-status';

const base: UpdateSignals = {
  isEnabled: true,
  isChecking: false,
  isDownloading: false,
  isUpdateAvailable: false,
  isUpdatePending: false,
  hasCheckError: false,
  hasChecked: true,
};
const status = (over: Partial<UpdateSignals>) => deriveUpdateStatus({ ...base, ...over });

describe('deriveUpdateStatus', () => {
  it('has nothing to say in a development build', () => {
    expect(status({ isEnabled: false, isUpdateAvailable: true, isUpdatePending: true })).toBe('unsupported');
  });

  it('says checking until a check has completed', () => {
    expect(status({ hasChecked: false })).toBe('checking');
    expect(status({ isChecking: true })).toBe('checking');
  });

  it('says up to date only after a check that reached the server', () => {
    expect(status({})).toBe('upToDate');
  });

  it('never reports up to date for a failed check', () => {
    expect(status({ hasCheckError: true })).toBe('unknown');
  });

  it('reports an update that exists but is not downloaded', () => {
    expect(status({ isUpdateAvailable: true })).toBe('available');
  });

  it('prefers ready-to-restart over available, because available stays true after the download', () => {
    expect(status({ isUpdateAvailable: true, isUpdatePending: true })).toBe('readyToRestart');
  });

  it('reports a download in progress over a stale availability flag', () => {
    expect(status({ isUpdateAvailable: true, isDownloading: true })).toBe('downloading');
  });

  it('keeps showing a downloaded update while a recheck runs', () => {
    expect(status({ isUpdatePending: true, isChecking: true })).toBe('readyToRestart');
  });
});

describe('updateAction', () => {
  it('offers the step that moves things forward', () => {
    expect(updateAction('available')).toBe('download');
    expect(updateAction('readyToRestart')).toBe('restart');
  });

  it('lets someone check again after a finished check, whatever it said', () => {
    expect(updateAction('upToDate')).toBe('check');
    expect(updateAction('unknown')).toBe('check');
  });

  it('offers nothing while work is in progress or when updates are unsupported', () => {
    expect(updateAction('checking')).toBeNull();
    expect(updateAction('downloading')).toBeNull();
    expect(updateAction('unsupported')).toBeNull();
  });
});

describe('updateMessage', () => {
  it('is silent only when unsupported', () => {
    expect(updateMessage('unsupported')).toBeNull();
    for (const s of ['checking', 'upToDate', 'available', 'downloading', 'readyToRestart', 'unknown'] as const) {
      expect(updateMessage(s)).toBeTruthy();
    }
  });
});
