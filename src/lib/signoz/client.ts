export type ErrorKind = 'network' | 'auth' | 'forbidden' | 'not-found' | 'bad-request' | 'server' | 'unknown';

export class SignozError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SignozError';
  }
}

export interface Credentials {
  endpoint: string;
  apiKey: string;
}

const REQUEST_TIMEOUT_MS = 20_000;

/** Hosts where plain http is acceptable: nothing on the public internet can be listening there. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal')) return true;
  // A bare name with no dot ("signoz", "nas") only resolves on a local network.
  if (!host.includes('.') && !host.includes(':')) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT, which Tailscale uses
  );
}

export type EndpointResult = { ok: true; endpoint: string } | { ok: false; error: string };

export function normalizeEndpoint(input: string): EndpointResult {
  let value = input.trim();
  if (!value) return { ok: false, error: 'Enter your SigNoz URL.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'That does not look like a URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'The URL must start with https:// or http://.' };
  }
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    return {
      ok: false,
      error: 'Plain http is only allowed for local network addresses. Use https for anything reachable from the internet.',
    };
  }
  // Pasting a page from the SigNoz UI is common; keep only the origin plus any reverse-proxy prefix.
  const path = url.pathname.replace(/\/+$/, '');
  const withoutAppPath = path.replace(/\/(api|alerts|logs|services|traces?|dashboard|home|settings)(\/.*)?$/, '');
  return { ok: true, endpoint: `${url.origin}${withoutAppPath}` };
}

function messageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') {
    return (err as Record<string, string>).message;
  }
  if (typeof b.message === 'string') return b.message;
  return undefined;
}

function kindForStatus(status: number): ErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 405) return 'not-found';
  if (status >= 400 && status < 500) return 'bad-request';
  if (status >= 500) return 'server';
  return 'unknown';
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export class SignozClient {
  constructor(
    readonly credentials: Credentials,
    // Wrapped, not `fetch` itself: browsers throw "Illegal invocation" when fetch runs with `this` set to the client.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  get endpoint() {
    return this.credentials.endpoint;
  }

  /** Returns the `data` member of SigNoz's `{status, data}` envelope (or the body, for endpoints without one). */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const params = Object.entries(options.query ?? {})
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.credentials.endpoint}${path}${params ? `?${params}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: {
          'SIGNOZ-API-KEY': this.credentials.apiKey,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      if (options.signal?.aborted) throw e;
      const timedOut = controller.signal.aborted;
      throw new SignozError(
        timedOut
          ? 'The request timed out. Check that the server is reachable from this device.'
          : 'Could not reach the server. Check the URL, your connection, and that the certificate is valid.',
        'network',
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (!response.ok) {
      const kind = kindForStatus(response.status);
      const fallback =
        kind === 'auth'
          ? 'The API key was rejected.'
          : kind === 'forbidden'
            ? 'The API key does not have permission for this.'
            : `Request failed (${response.status}).`;
      throw new SignozError(messageFromBody(json) ?? fallback, kind, response.status);
    }

    if (json === undefined) {
      // A 200 that is not JSON is almost always a login page or a proxy answering in SigNoz's place.
      throw new SignozError('The server did not answer like SigNoz. Is the URL right?', 'unknown', response.status);
    }
    if (json && typeof json === 'object' && 'status' in json) {
      const env = json as { status?: string; data?: unknown };
      if (env.status === 'error') throw new SignozError(messageFromBody(json) ?? 'SigNoz reported an error.', 'server');
      return (env.data ?? json) as T;
    }
    return json as T;
  }

  /**
   * Checks the endpoint and key together. Newer SigNoz exposes `/service_accounts/me`; older versions
   * do not, so a 404 there falls back to a read that every Viewer key can make.
   */
  async verify(signal?: AbortSignal): Promise<void> {
    try {
      await this.request('/api/v1/service_accounts/me', { signal });
      return;
    } catch (e) {
      if (!(e instanceof SignozError) || e.kind !== 'not-found') throw e;
    }
    await this.request('/api/v1/rules', { signal });
  }
}
