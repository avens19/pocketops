import { describe, expect, it } from 'vitest';

import { SignozClient, SignozError, isPrivateHost, normalizeEndpoint } from './client';

interface FakeResponse {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  redirected?: boolean;
}

function fakeFetch(responses: Record<string, FakeResponse>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]!;
    const r = responses[path] ?? { status: 404, body: { status: 'error', error: { message: 'not found' } } };
    const response = new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
    if (r.redirected) Object.defineProperty(response, 'redirected', { value: true });
    return response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** What SigNoz returns for a route it does not have: its web UI, with a 200. */
const UI_PAGE: FakeResponse = { text: '<!doctype html><html></html>', headers: { 'Content-Type': 'text/html; charset=utf-8' } };

const creds = { endpoint: 'https://signoz.example.com', apiKey: 'k' };

describe('normalizeEndpoint', () => {
  it('adds https and strips trailing slashes', () => {
    expect(normalizeEndpoint('signoz.example.com/')).toEqual({ ok: true, endpoint: 'https://signoz.example.com' });
  });

  it('reduces a pasted UI page to its origin', () => {
    expect(normalizeEndpoint('https://signoz.example.com/alerts/overview?ruleId=1')).toEqual({
      ok: true,
      endpoint: 'https://signoz.example.com',
    });
  });

  it('keeps a reverse proxy prefix', () => {
    expect(normalizeEndpoint('https://example.com/signoz/')).toEqual({ ok: true, endpoint: 'https://example.com/signoz' });
  });

  it('allows http on private networks only', () => {
    expect(normalizeEndpoint('http://192.168.1.20:3301')).toEqual({ ok: true, endpoint: 'http://192.168.1.20:3301' });
    expect(normalizeEndpoint('http://signoz.example.com').ok).toBe(false);
  });

  it('rejects empty and non-http input', () => {
    expect(normalizeEndpoint('  ').ok).toBe(false);
    expect(normalizeEndpoint('ftp://example.com').ok).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it.each(['localhost', '10.0.0.5', '172.16.4.1', '172.31.255.1', '192.168.0.2', '100.101.1.1', 'nas', 'box.local'])(
    '%s is private',
    (h) => expect(isPrivateHost(h)).toBe(true),
  );
  it.each(['8.8.8.8', '172.32.0.1', '100.63.0.1', 'signoz.example.com'])('%s is public', (h) =>
    expect(isPrivateHost(h)).toBe(false),
  );
});

describe('SignozClient', () => {
  it('sends the key header and unwraps the envelope', async () => {
    const { impl, calls } = fakeFetch({ '/api/v1/alerts': { body: { status: 'success', data: [1, 2] } } });
    const data = await new SignozClient(creds, impl).request<number[]>('/api/v1/alerts');
    expect(data).toEqual([1, 2]);
    expect((calls[0]!.init.headers as Record<string, string>)['SIGNOZ-API-KEY']).toBe('k');
  });

  it('maps 401 to an auth error with an actionable message, not the server\'s one-word reply', async () => {
    const { impl } = fakeFetch({ '/x': { status: 401, body: { status: 'error', error: { message: 'bad key' } } } });
    await expect(new SignozClient(creds, impl).request('/x')).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('API key was rejected') });
  });

  it('treats a non-JSON 200 as the wrong server', async () => {
    const { impl } = fakeFetch({ '/x': { text: '<html>login</html>' } });
    await expect(new SignozClient(creds, impl).request('/x')).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('treats the SigNoz UI page as a missing endpoint', async () => {
    const { impl } = fakeFetch({ '/x': UI_PAGE });
    await expect(new SignozClient(creds, impl).request('/x')).rejects.toMatchObject({
      kind: 'not-found',
      message: expect.stringContaining('did not answer like SigNoz'),
    });
  });

  it('treats a redirect to an HTML login page as the wrong server', async () => {
    const { impl } = fakeFetch({ '/x': { ...UI_PAGE, redirected: true } });
    await expect(new SignozClient(creds, impl).request('/x')).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('reports network failures distinctly', async () => {
    const impl = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(new SignozClient(creds, impl).request('/x')).rejects.toMatchObject({ kind: 'network' });
  });

  it('verify falls back to the rules endpoint on older servers', async () => {
    const { impl, calls } = fakeFetch({ '/api/v1/rules': { body: { status: 'success', data: { rules: [] } } } });
    await new SignozClient(creds, impl).verify();
    expect(calls.map((c) => c.url)).toEqual([
      'https://signoz.example.com/api/v1/service_accounts/me',
      'https://signoz.example.com/api/v1/rules',
    ]);
  });

  it('verify falls back when an older server answers service_accounts/me with its UI page', async () => {
    const { impl, calls } = fakeFetch({
      '/api/v1/service_accounts/me': UI_PAGE,
      '/api/v1/rules': { body: { status: 'success', data: { rules: [] } } },
    });
    await new SignozClient(creds, impl).verify();
    expect(calls.map((c) => c.url)).toEqual([
      'https://signoz.example.com/api/v1/service_accounts/me',
      'https://signoz.example.com/api/v1/rules',
    ]);
  });

  it('verify surfaces a rejected key without falling back', async () => {
    const { impl, calls } = fakeFetch({ '/api/v1/service_accounts/me': { status: 401, body: {} } });
    await expect(new SignozClient(creds, impl).verify()).rejects.toBeInstanceOf(SignozError);
    expect(calls).toHaveLength(1);
  });
});
