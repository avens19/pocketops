import { describe, expect, it, vi } from 'vitest';
import { SignozClient } from './client';
import { checkViewPermission, viewPermissionKey } from './permissions';

const object = (selector: string) => ({ resource: { type: 'metaresource', kind: 'saved-view' }, selector });
function fixture(data: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: status === 200 ? 'success' : 'error', data }), { status }));
  return { client: new SignozClient({ endpoint: 'https://signoz.example', apiKey: 'secret' }, fetcher as unknown as typeof fetch), fetcher };
}

describe('saved view permission checks', () => {
  it('checks create on the saved-view collection with the current key, without writing a view', async () => {
    const { client, fetcher } = fixture([{ relation: 'create', object: object('*'), authorized: true }]);
    expect(await checkViewPermission(client, { action: 'create' })).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://signoz.example/api/v1/authz/check');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({ 'SIGNOZ-API-KEY': 'secret' });
    expect(JSON.parse(options?.body as string)).toEqual([{ relation: 'create', object: object('*') }]);
  });
  it('checks update on the exact view and does not infer it from create permission', async () => {
    const { client, fetcher } = fixture([
      { relation: 'create', object: object('*'), authorized: true },
      { relation: 'update', object: object('view-1'), authorized: false },
    ]);
    expect(await checkViewPermission(client, { action: 'update', id: 'view-1' })).toBe(false);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual([{ relation: 'update', object: object('view-1') }]);
  });
  it('can allow update without allowing create', async () => {
    const { client } = fixture([
      { relation: 'create', object: object('*'), authorized: false },
      { relation: 'update', object: object('view-1'), authorized: true },
    ]);
    expect(await checkViewPermission(client, { action: 'create' })).toBe(false);
    expect(await checkViewPermission(client, { action: 'update', id: 'view-1' })).toBe(true);
  });
  it('does not grant permission from missing, malformed, conflicting or unrelated responses', async () => {
    const grant = { relation: 'create', object: object('*'), authorized: true };
    for (const data of [null, {}, [], [grant, grant], [{ ...grant, authorized: 'true' }], [{ ...grant, relation: 'read' }], [{ ...grant, object: object('other-view') }], [{ ...grant, object: { ...object('*'), resource: { type: 'metaresource', kind: 'dashboard' } } }]]) {
      await expect(checkViewPermission(fixture(data).client, { action: 'create' })).rejects.toThrow('permission decision');
    }
  });
  it('keeps unsupported servers, denied checks and network/server failures distinct from a grant', async () => {
    for (const status of [401, 403, 404, 500]) {
      await expect(checkViewPermission(fixture(null, status).client, { action: 'create' })).rejects.toMatchObject({ status });
    }
  });
  it('passes cancellation through to the request', async () => {
    const { client } = fixture([]);
    const request = vi.spyOn(client, 'request');
    const controller = new AbortController();
    await expect(checkViewPermission(client, { action: 'create' }, controller.signal)).rejects.toThrow();
    expect(request).toHaveBeenCalledWith('/api/v1/authz/check', expect.objectContaining({ signal: controller.signal }));
  });
  it('separates cached decisions by server, action and view without storing the key', () => {
    const create = viewPermissionKey('https://one.example', { action: 'create' });
    expect(create).not.toEqual(viewPermissionKey('https://two.example', { action: 'create' }));
    expect(create).not.toEqual(viewPermissionKey('https://one.example', { action: 'update', id: '1' }));
    expect(viewPermissionKey('https://one.example', { action: 'update', id: '1' })).not.toEqual(viewPermissionKey('https://one.example', { action: 'update', id: '2' }));
  });
});
