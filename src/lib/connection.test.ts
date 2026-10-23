import { describe, expect, it } from 'vitest';

import { isRecoverable, nextStatus, type ConnectionStatus } from './connection-status';
import { SignozError } from './signoz/client';

const ok: ConnectionStatus = { failing: false, lastOkAt: 1000 };
const fail = (kind: ConstructorParameters<typeof SignozError>[1]) => ({ type: 'error' as const, error: new SignozError('x', kind) });

describe('nextStatus', () => {
  it('starts failing on a network, server or auth error', () => {
    for (const kind of ['network', 'server', 'auth'] as const) {
      expect(nextStatus(ok, fail(kind), 2000)).toMatchObject({ failing: true, kind, lastOkAt: 1000 });
    }
  });

  it('ignores errors that are not about reaching the server', () => {
    for (const kind of ['not-found', 'bad-request', 'forbidden', 'unknown'] as const) {
      expect(nextStatus(ok, fail(kind), 2000)).toBe(ok);
    }
    expect(nextStatus(ok, { type: 'error', error: new Error('boom') }, 2000)).toBe(ok);
  });

  it('ignores an aborted request', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(nextStatus(ok, { type: 'error', error: abort }, 2000)).toBe(ok);
  });

  it('recovers on the next success and remembers when', () => {
    const failing = nextStatus(ok, fail('network'), 2000);
    expect(nextStatus(failing, { type: 'success' }, 5000)).toEqual({ failing: false, lastOkAt: 5000 });
  });

  it('does not churn state on a burst of identical failures or successes', () => {
    const failing = nextStatus(ok, fail('network'), 2000);
    expect(nextStatus(failing, fail('network'), 2100)).toBe(failing);
    expect(nextStatus(ok, { type: 'success' }, 1500)).toBe(ok);
  });

  it('switches the reason when the failure changes', () => {
    const failing = nextStatus(ok, fail('network'), 2000);
    expect(nextStatus(failing, fail('auth'), 2100)).toMatchObject({ failing: true, kind: 'auth' });
  });
});

describe('isRecoverable', () => {
  it('retries what a retry can fix, and nothing else', () => {
    expect(isRecoverable(new SignozError('x', 'network'))).toBe(true);
    expect(isRecoverable(new SignozError('x', 'server'))).toBe(true);
    for (const kind of ['auth', 'forbidden', 'not-found', 'bad-request', 'unknown'] as const) {
      expect(isRecoverable(new SignozError('x', kind))).toBe(false);
    }
    expect(isRecoverable(new Error('boom'))).toBe(false);
    expect(isRecoverable(undefined)).toBe(false);
  });
});
