import { quote } from './signoz/queries';

/**
 * Structured view of a SigNoz filter expression, so the logs and traces screens can show removable chips and
 * let a tapped attribute add or exclude itself. The expression string stays the source of truth: anything this
 * module cannot read back (OR, parentheses, functions) is kept verbatim as a `raw` clause and survives edits.
 */

export type FilterOp =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'CONTAINS'
  | 'NOT CONTAINS'
  | 'EXISTS'
  | 'NOT EXISTS'
  | 'IN'
  | 'NOT IN';

export type FilterValue = string | number | boolean;

export type Clause =
  | { kind: 'filter'; key: string; op: FilterOp; value?: FilterValue; values?: FilterValue[] }
  | { kind: 'raw'; text: string };

const OPS: FilterOp[] = ['NOT CONTAINS', 'NOT EXISTS', 'NOT IN', 'CONTAINS', 'EXISTS', 'IN', '!=', '>=', '<=', '=', '>', '<'];

export const OP_LABEL: Record<FilterOp, string> = {
  '=': 'is',
  '!=': 'is not',
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  CONTAINS: 'contains',
  'NOT CONTAINS': 'does not contain',
  EXISTS: 'exists',
  'NOT EXISTS': 'does not exist',
  IN: 'is one of',
  'NOT IN': 'is none of',
};

/** Operators that take no value. */
export const UNARY_OPS: FilterOp[] = ['EXISTS', 'NOT EXISTS'];

function literal(value: FilterValue): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return quote(value);
}

export function clauseToExpression(c: Clause): string {
  if (c.kind === 'raw') return c.text;
  if (UNARY_OPS.includes(c.op)) return `${c.key} ${c.op}`;
  if (c.op === 'IN' || c.op === 'NOT IN') return `${c.key} ${c.op} (${(c.values ?? []).map(literal).join(', ')})`;
  return `${c.key} ${c.op} ${literal(c.value ?? '')}`;
}

/** Joins clauses with AND. A raw clause is parenthesised when it could change precedence (it may contain OR). */
export function clausesToExpression(clauses: Clause[]): string {
  const parts = clauses.map((c) => {
    const text = clauseToExpression(c);
    // A raw clause with a top-level OR must keep its own grouping once AND-ed with anything else.
    return c.kind === 'raw' && clauses.length > 1 && hasTopLevelOr(text) ? `(${text})` : text;
  });
  return parts.filter(Boolean).join(' AND ');
}

/** Splits on AND at depth 0, outside quotes. */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoteChar: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quoteChar) {
      if (ch === '\\') i++;
      else if (ch === quoteChar) quoteChar = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quoteChar = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && /\s/.test(ch)) {
      const m = /^\s+AND\s+/i.exec(expr.slice(i));
      if (m) {
        parts.push(expr.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Reads `token` as exactly one literal: a quoted string, a number that survives a round trip, or true/false.
 * Anything with text after the literal (`'a' OR x = 'b'`) is not a literal, so the clause stays raw rather than
 * being squashed into one wrong comparison.
 */
function unquote(token: string): FilterValue | undefined {
  const t = token.trim();
  const q = t[0];
  if (q === "'" || q === '"') {
    for (let i = 1; i < t.length; i++) {
      if (t[i] === '\\') i++;
      else if (t[i] === q) return i === t.length - 1 ? t.slice(1, -1).replace(/\\(.)/g, '$1') : undefined;
    }
    return undefined;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    // Keep the clause verbatim when a number would change on the way through (too big, or written as 1.50 / 007).
    return String(n) === t ? n : undefined;
  }
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  return undefined;
}

/** Splits `'a', 'b', 3` at top-level commas, outside quotes. */
function splitList(inner: string): string[] {
  const out: string[] = [];
  let quoteChar: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quoteChar) {
      if (ch === '\\') i++;
      else if (ch === quoteChar) quoteChar = null;
    } else if (ch === "'" || ch === '"') quoteChar = ch;
    else if (ch === ',') {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out;
}

const KEY = /^([A-Za-z_@][\w.@$:/-]*)/;
const WHOLE_KEY = /^[A-Za-z_@][\w.@$:/-]*$/;

/** True when `key` can be written into an expression as a bare field name. Anything else (spaces, quotes, operators) cannot be
 * turned into a clause without changing the query, so it must not become a chip. */
export function isValidKey(key: string): boolean {
  return WHOLE_KEY.test(key);
}

function parseClause(text: string): Clause {
  const raw: Clause = { kind: 'raw', text };
  const keyMatch = KEY.exec(text);
  if (!keyMatch) return raw;
  const key = keyMatch[1];
  const rest = text.slice(key.length).trimStart();
  const op = OPS.find((o) => rest.toUpperCase().startsWith(o) && (/[a-z]/i.test(o) ? !/^\w/.test(rest.slice(o.length)) : true));
  if (!op) return raw;
  const tail = rest.slice(op.length).trim();

  if (UNARY_OPS.includes(op)) return tail === '' ? { kind: 'filter', key, op } : raw;
  if (op === 'IN' || op === 'NOT IN') {
    const wrapped = (tail.startsWith('(') && tail.endsWith(')')) || (tail.startsWith('[') && tail.endsWith(']'));
    if (!wrapped) return raw;
    const values = splitList(tail.slice(1, -1)).map(unquote);
    return values.length > 0 && values.every((v) => v !== undefined)
      ? { kind: 'filter', key, op, values: values as FilterValue[] }
      : raw;
  }
  const value = unquote(tail);
  return value === undefined ? raw : { kind: 'filter', key, op, value };
}

/** True when one pair of parentheses encloses the whole text, as in `(a = 1 AND b = 2)` but not `(a) AND (b)`. */
function fullyWrapped(text: string): boolean {
  if (!text.startsWith('(') || !text.endsWith(')')) return false;
  let depth = 0;
  let quoteChar: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoteChar) {
      if (ch === '\\') i++;
      else if (ch === quoteChar) quoteChar = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quoteChar = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0 && i < text.length - 1) return false;
  }
  return depth === 0;
}

/** True when `text` has an OR outside quotes and parentheses. */
function hasTopLevelOr(text: string): boolean {
  let depth = 0;
  let quoteChar: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoteChar) {
      if (ch === '\\') i++;
      else if (ch === quoteChar) quoteChar = null;
    } else if (ch === "'" || ch === '"' || ch === '`') quoteChar = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && /\s/.test(ch) && /^\s+OR\s+/i.test(text.slice(i))) return true;
  }
  return false;
}

export function parseExpression(expr: string): Clause[] {
  const text = expr.trim();
  if (!text) return [];
  // AND binds tighter than OR, so an expression with a top-level OR is one unit: splitting it on AND would regroup it.
  if (hasTopLevelOr(text)) return [{ kind: 'raw', text }];
  return splitTopLevel(text).flatMap((part): Clause[] => {
    // A parenthesised AND-group is just its clauses; one containing OR cannot be shown as chips and stays whole.
    if (fullyWrapped(part)) {
      const inner = part.slice(1, -1).trim();
      return hasTopLevelOr(inner) ? [{ kind: 'raw', text: part }] : parseExpression(inner);
    }
    return [parseClause(part)];
  });
}

function sameTarget(a: Clause, b: Clause): boolean {
  return a.kind === 'filter' && b.kind === 'filter' && a.key === b.key;
}

function sameValue(a: Clause, b: Clause): boolean {
  if (a.kind !== 'filter' || b.kind !== 'filter') return false;
  return a.key === b.key && a.op === b.op && a.value === b.value && JSON.stringify(a.values) === JSON.stringify(b.values);
}

/**
 * Adds a clause. An identical clause is not duplicated. Adding `k = v` replaces an existing `k != v` (and vice versa) because
 * keeping both would match nothing, which is never what a tap meant.
 */
export function addClause(clauses: Clause[], next: Clause): Clause[] {
  if (clauses.some((c) => sameValue(c, next))) return clauses;
  if (next.kind === 'filter' && (next.op === '=' || next.op === '!=')) {
    const opposite = next.op === '=' ? '!=' : '=';
    const flipped = clauses.findIndex((c) => sameTarget(c, next) && c.kind === 'filter' && c.op === opposite && c.value === next.value);
    if (flipped !== -1) return clauses.map((c, i) => (i === flipped ? next : c));
  }
  return [...clauses, next];
}

export function removeClause(clauses: Clause[], index: number): Clause[] {
  return clauses.filter((_, i) => i !== index);
}

export function replaceClause(clauses: Clause[], index: number, next: Clause): Clause[] {
  return clauses.map((c, i) => (i === index ? next : c));
}

/** Parses attribute text as the narrowest literal that prints back unchanged: `502` and `true` compare as such, `007`, `1.50` and huge ids stay text. */
export function inferValue(text: string): FilterValue {
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (String(n) === text) return n;
  }
  if (text === 'true' || text === 'false') return text === 'true';
  return text;
}

export function describeClause(c: Clause): { key: string; op: string; value: string } {
  if (c.kind === 'raw') return { key: '', op: '', value: c.text };
  if (UNARY_OPS.includes(c.op)) return { key: c.key, op: OP_LABEL[c.op], value: '' };
  if (c.op === 'IN' || c.op === 'NOT IN') return { key: c.key, op: OP_LABEL[c.op], value: (c.values ?? []).join(', ') };
  return { key: c.key, op: OP_LABEL[c.op], value: String(c.value ?? '') };
}
