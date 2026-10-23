import { legacyExpression } from './deeplink';
import { parseExpression } from './filters';

export type RuleSignal = 'logs' | 'traces' | 'metrics';

/** What an alert rule evaluates: enough to jump from a firing alert to the data behind it. */
export interface RuleQuery {
  signal: RuleSignal;
  /** The rule's filter expression, empty when it has none. */
  expression: string;
  /** Fields the rule groups by; a firing instance carries a label for each, naming the thing that tripped it. */
  groupBy: string[];
}

type Json = Record<string, unknown>;

function asSignal(value: unknown): RuleSignal | null {
  const v = String(value ?? '').toLowerCase();
  if (v === 'logs' || v === 'traces' || v === 'metrics') return v;
  if (v === 'metric') return 'metrics';
  return null;
}

function groupNames(groupBy: unknown): string[] {
  if (!Array.isArray(groupBy)) return [];
  return (groupBy as Json[]).flatMap((g) => {
    const name = g.name ?? g.key;
    return typeof name === 'string' && name ? [name] : [];
  });
}

/**
 * Reads the query out of a rule definition. Current servers keep builder queries under `condition.compositeQuery.queries`;
 * older ones keep `builderQueries` keyed by name with a `filters.items` list. Returns null when there is no builder query
 * (a PromQL or ClickHouse rule), since those have no filter the explorers could take.
 */
export function parseRuleQuery(definition: unknown): RuleQuery | null {
  const composite = ((definition as Json | undefined)?.condition as Json | undefined)?.compositeQuery as Json | undefined;
  if (!composite) return null;
  const selected = (definition as { condition?: { selectedQueryName?: string } }).condition?.selectedQueryName;

  if (Array.isArray(composite.queries)) {
    const builders = (composite.queries as Json[]).filter((q) => q.type === 'builder_query').map((q) => (q.spec ?? {}) as Json);
    const spec = builders.find((s) => s.name === selected) ?? builders.find((s) => s.disabled !== true) ?? builders[0];
    const signal = asSignal(spec?.signal);
    if (!spec || !signal) return null;
    const filter = spec.filter as { expression?: string } | undefined;
    return { signal, expression: (filter?.expression ?? '').trim(), groupBy: groupNames(spec.groupBy) };
  }

  const legacy = composite.builderQueries as Record<string, Json> | undefined;
  if (legacy) {
    const q = legacy[selected ?? ''] ?? Object.values(legacy).find((x) => x.disabled !== true) ?? Object.values(legacy)[0];
    const signal = asSignal(q?.dataSource);
    if (!q || !signal) return null;
    const filter = q.filter as { expression?: string } | undefined;
    return { signal, expression: (filter?.expression ?? '').trim() || legacyExpression(q.filters), groupBy: groupNames(q.groupBy) };
  }
  return null;
}

/**
 * The rule's filter narrowed to one firing instance: its labels for the fields the rule groups by. A constraint is skipped
 * only when the filter already pins that exact field to that exact value as a plain AND-ed clause; with an OR in the filter
 * (`service.name = 'a' OR service.name = 'b'`) it must be added, or the instance would show every branch.
 */
export function instanceExpression(query: RuleQuery, labels: Record<string, string>, quote: (v: string) => string): string {
  const parts = query.expression ? [`(${query.expression})`] : [];
  const pinned = parseExpression(query.expression);
  for (const field of query.groupBy) {
    const value = labels[field];
    if (value === undefined) continue;
    const already = pinned.some((c) => c.kind === 'filter' && c.key === field && c.op === '=' && String(c.value) === value);
    if (!already) parts.push(`${field} = ${quote(value)}`);
  }
  return parts.join(' AND ');
}
