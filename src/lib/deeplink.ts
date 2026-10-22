/**
 * Turns a link into an in-app route.
 *
 * Two kinds are understood: this app's own scheme (`pocketops://alerts/<id>`) and the web URLs SigNoz puts
 * in alert notifications and the browser address bar. The app does not claim the server's domain, so web
 * URLs arrive by paste or by share sheet and are mapped here.
 *
 * Explorer links (logs, traces) carry their whole query in the URL, so those are unpacked into the filter
 * expression, grouping and time range the app screens take as route params.
 *
 * Returns null for anything we do not recognise.
 */
export function routeForUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol === 'pocketops:') {
    // pocketops://alerts/123 parses with "alerts" as the host.
    const path = `/${url.host}${url.pathname}`.replace(/\/+$/, '');
    return path === '' || path === '/' ? '/alerts' : path;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);
  const [first, second] = segments;
  const params = url.searchParams;

  if (first === 'alerts') {
    const ruleId = params.get('ruleId') ?? params.get('ruleid');
    return ruleId ? `/alerts/${encodeURIComponent(ruleId)}` : '/alerts';
  }
  if (first === 'services') {
    return second ? `/services/${encodeURIComponent(second)}` : '/services';
  }
  if (first === 'logs') {
    const query = explorerQuery(params);
    return withParams('/logs', { q: query?.expression, ...timeParams(params) });
  }
  if (first === 'traces-explorer') {
    const query = explorerQuery(params);
    return withParams('/traces', {
      q: query?.expression,
      groupBy: query?.groupBy.join(','),
      op: query?.hasTraceOperator ? '1' : undefined,
      ...timeParams(params),
    });
  }
  if (first === 'trace' && second) {
    return withParams('/traces', { q: `trace_id = '${second.replace(/['\\]/g, '')}'`, ...timeParams(params) });
  }
  if (first === 'metrics-explorer' || first === 'metrics') return '/metrics';
  return null;
}

/** Extracts the first URL from shared text such as "Alert firing: https://… (3 labels)". */
export function firstUrl(text: string): string | null {
  const m = text.match(/(?:https?|pocketops):\/\/[^\s<>"')]+/i);
  return m ? m[0] : null;
}

// ---- explorer links --------------------------------------------------------------------------

export interface ExplorerQuery {
  signal: string;
  expression: string;
  groupBy: string[];
  /** The link uses a trace operator ("B -> A"), which the app cannot run; only query A is shown. */
  hasTraceOperator: boolean;
}

type Json = Record<string, unknown>;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function withParams(path: string, params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return pairs.length ? `${path}?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : path;
}

/**
 * SigNoz stores the query as JSON in `compositeQuery`, URL-encoded twice: the browser decodes the first
 * layer (URLSearchParams), the second is `encodeURIComponent` or form encoding (`+` for a space).
 */
function decodeComposite(raw: string): Json | null {
  const attempts = [raw, safeDecode(raw.replace(/\+/g, ' '))];
  for (const text of attempts) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed as Json;
    } catch {
      // try the next decoding
    }
  }
  return null;
}

const LEGACY_OPS: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  in: 'IN',
  nin: 'NOT IN',
  contains: 'CONTAINS',
  ncontains: 'NOT CONTAINS',
  like: 'LIKE',
  nlike: 'NOT LIKE',
  exists: 'EXISTS',
  nexists: 'NOT EXISTS',
};

function literal(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Older links keep the filter as `filters.items` rather than an expression string. */
function legacyExpression(filters: unknown): string {
  const items = (filters as { items?: unknown[]; op?: string } | undefined)?.items;
  if (!Array.isArray(items)) return '';
  const joiner = (filters as { op?: string }).op?.toUpperCase() === 'OR' ? ' OR ' : ' AND ';
  return items
    .flatMap((item) => {
      const i = item as { key?: { key?: string }; op?: string; value?: unknown };
      const key = i.key?.key;
      const op = i.op ? LEGACY_OPS[i.op.toLowerCase()] : undefined;
      if (!key || !op) return [];
      if (op === 'EXISTS' || op === 'NOT EXISTS') return [`${key} ${op}`];
      if (op === 'IN' || op === 'NOT IN') {
        const values = Array.isArray(i.value) ? i.value : [i.value];
        return [`${key} ${op} [${values.map(literal).join(', ')}]`];
      }
      return [`${key} ${op} ${literal(i.value)}`];
    })
    .join(joiner);
}

/** Pulls the first usable query out of a logs/traces explorer URL's `compositeQuery`. */
export function explorerQuery(params: URLSearchParams): ExplorerQuery | null {
  const raw = params.get('compositeQuery');
  const composite = raw ? decodeComposite(raw) : null;
  const builder = composite?.builder as { queryData?: Json[]; queryTraceOperator?: unknown[] } | undefined;
  const queries = builder?.queryData;
  if (!Array.isArray(queries) || queries.length === 0) return null;

  const q = queries.find((x) => !x.disabled) ?? queries[0];
  const filter = q.filter as { expression?: string } | undefined;
  const expression = (filter?.expression ?? '').trim() || legacyExpression(q.filters);
  const groupBy = Array.isArray(q.groupBy)
    ? (q.groupBy as { key?: string; name?: string }[]).flatMap((g) => g.key ?? g.name ?? [])
    : [];
  return {
    signal: String(q.dataSource ?? q.signal ?? ''),
    expression,
    groupBy,
    hasTraceOperator: Array.isArray(builder?.queryTraceOperator) && builder.queryTraceOperator.length > 0,
  };
}

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "30m", "1d", "1w" → milliseconds. */
export function relativeTimeMs(value: string): number | null {
  const m = value.trim().replace(/^"|"$/g, '').match(/^(\d+)([smhdw])$/);
  return m ? Number(m[1]) * UNIT_MS[m[2]] : null;
}

/** SigNoz writes start/end as milliseconds, but older links use seconds or nanoseconds. */
function toMillis(n: number): number {
  if (n > 1e17) return Math.round(n / 1e6);
  if (n > 1e14) return Math.round(n / 1e3);
  if (n < 1e11) return n * 1000;
  return n;
}

/** The time window in a link, as route params: `last` (a duration) or `from`/`to` (epoch ms). */
export function timeParams(params: URLSearchParams): { last?: string; from?: string; to?: string } {
  const start = Number(params.get('startTime'));
  const end = Number(params.get('endTime'));
  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > start) {
    return { from: String(toMillis(start)), to: String(toMillis(end)) };
  }
  const rel = params.get('relativeTime');
  const ms = rel ? relativeTimeMs(rel) : null;
  return ms ? { last: String(ms) } : {};
}
