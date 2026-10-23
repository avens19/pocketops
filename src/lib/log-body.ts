/**
 * A log's `body` is not always text. Structured loggers (JSON lines) arrive as an object, and some pipelines leave JSON as a string.
 * Showing `String(body)` for an object gives "[object Object]", so a body is parsed into a one-line summary for lists, readable JSON
 * for the detail screen, and its fields for filtering.
 */

export interface ParsedBody {
  /** The log's message: a structured body's `message` (or `msg`, `log`...), or the text itself. Falls back to the extras when a body has none. */
  headline: string;
  /** A few telling fields beside the message (`method=GET status=200`), for a quieter second line. Empty when there is nothing to add. */
  details: string;
  /** Both as one line. */
  summary: string;
  /** The whole body, readable: pretty-printed JSON for structured bodies, the text otherwise. */
  pretty: string;
  /** Top-level and nested fields (dotted paths) as text, for structured bodies. */
  fields?: Record<string, string>;
  /**
   * True when the server returned an object, so its fields can be queried as `body.<key>`. A JSON string is shown the same way but
   * cannot be filtered on its fields, because to the server it is still just text.
   */
  filterable: boolean;
}

type Json = Record<string, unknown>;

/** Which field holds the human-readable message, in order of preference. */
const MESSAGE_KEYS = ['message', 'msg', 'log', 'text', 'event', 'body'];

/** Fields worth a glance beside the message, in order. Anything else is left for the detail screen. */
const PRIORITY_KEYS = ['method', 'path', 'uri', 'url', 'route', 'status', 'statusCode', 'status_code', 'code', 'error', 'err', 'duration', 'latency_human', 'latency', 'user', 'userId', 'user_id'];

/** Housekeeping fields the row already shows elsewhere (severity, time) or that add nothing to a glance. */
const SKIP_KEYS = new Set(['level', 'severity', 'lvl', 'ts', 'time', 'timestamp', 'logger', 'caller', 'trace', 'trace_id', 'traceId', 'span_id', 'spanId']);

const MAX_EXTRAS = 4;
const MAX_SUMMARY = 220;

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Flattens nested objects into dotted paths (`user.id`), a few levels deep; arrays and deeper objects stay as JSON text. */
function flatten(obj: Json, prefix = '', depth = 0, out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v) && depth < 2) flatten(v, key, depth + 1, out);
    else out[key] = text(v);
  }
  return out;
}

function summarize(obj: Json): { headline: string; details: string } {
  const messageKey = MESSAGE_KEYS.find((k) => typeof obj[k] === 'string' && (obj[k] as string).trim() !== '');
  const message = messageKey ? (obj[messageKey] as string).trim() : '';

  const used = new Set<string>(message ? [message] : []);
  const extras: string[] = [];
  const consider = (key: string) => {
    if (extras.length >= MAX_EXTRAS || key === messageKey || SKIP_KEYS.has(key) || !(key in obj)) return;
    const v = obj[key];
    if (v === null || v === undefined || v === '' || isObject(v)) return;
    const value = text(v);
    // path and uri often repeat each other; do not show the same value twice.
    if (used.has(value) || message.includes(value)) return;
    used.add(value);
    extras.push(`${key}=${value}`);
  };
  PRIORITY_KEYS.forEach(consider);
  // No message and no recognised fields: fall back to whatever scalars come first, so the row is never empty.
  if (!message && extras.length === 0) Object.keys(obj).forEach(consider);

  const details = extras.join(' ');
  // Without a message the fields are all there is, so they become the headline.
  return message ? { headline: message.slice(0, MAX_SUMMARY), details: details.slice(0, MAX_SUMMARY) } : { headline: details.slice(0, MAX_SUMMARY), details: '' };
}

function parsedObject(obj: Json, filterable: boolean, raw: string): ParsedBody {
  const { headline, details } = summarize(obj);
  const summary = [headline, details].filter(Boolean).join('  ');
  return {
    headline: headline || raw,
    details,
    summary: summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY - 1)}…` : summary || raw,
    pretty: JSON.stringify(obj, null, 2),
    fields: flatten(obj),
    filterable,
  };
}

export function parseLogBody(body: unknown): ParsedBody {
  if (isObject(body)) return parsedObject(body, true, JSON.stringify(body));
  if (Array.isArray(body)) {
    const raw = JSON.stringify(body);
    return { headline: raw, details: '', summary: raw, pretty: JSON.stringify(body, null, 2), filterable: false };
  }
  const raw = text(body);
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isObject(parsed)) return parsedObject(parsed, false, raw);
    } catch {
      // not JSON after all: plain text
    }
  }
  return { headline: raw, details: '', summary: raw, pretty: raw, filterable: false };
}
