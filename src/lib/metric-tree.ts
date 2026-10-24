/**
 * Metric names are dotted paths (`http.server.request.duration`) or, for Prometheus-style names, underscored (`node_cpu_seconds_total`).
 * A flat list of hundreds is unusable on a phone, so names are browsed like folders: each level groups by the next segment, a chain of
 * single-child levels is collapsed, and a level small enough to scan is shown flat.
 */

/** At or below this many metrics a level is shown as a plain list instead of being split into groups. */
export const FLAT_LIMIT = 15;
/** A group this small is not worth a tap; its metrics are listed in place. */
export const INLINE_GROUP = 2;

export interface NamedMetric {
  name: string;
}

export type MetricEntry<T extends NamedMetric> =
  | { kind: 'group'; prefix: string; label: string; count: number }
  | { kind: 'metric'; metric: T; label: string };

export interface Level<T extends NamedMetric> {
  /** Where this level really starts: the requested prefix, extended through any segments every metric shares. */
  prefix: string;
  /** Every metric at or under the prefix. */
  total: number;
  entries: MetricEntry<T>[];
}

/** Dotted names split on dots; names without a dot are split on underscores. */
function separator(name: string): string {
  return name.includes('.') ? '.' : '_';
}

/** What follows `prefix` in `name`: '' when the name is the prefix itself, null when it is not under it. */
function remainder(name: string, prefix: string): string | null {
  if (prefix === '') return name;
  if (name === prefix) return '';
  return name.startsWith(prefix + separator(name)) ? name.slice(prefix.length + 1) : null;
}

function firstSegment(rest: string, name: string): string {
  const sep = separator(name);
  const i = rest.indexOf(sep);
  return i === -1 ? rest : rest.slice(0, i);
}

function join(prefix: string, segment: string, name: string): string {
  return prefix === '' ? segment : prefix + separator(name) + segment;
}

/** Case-insensitive, with the original as a tie-break so the order is stable. */
export function compareNames(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Extends `prefix` while every member continues through the same next segment. */
function collapse<T extends NamedMetric>(members: T[], prefix: string): string {
  let current = prefix;
  for (;;) {
    if (members.length < 2) return current;
    const sep = separator(members[0].name);
    let segment: string | null = null;
    for (const m of members) {
      const rest = remainder(m.name, current);
      // A metric named exactly the prefix, or a different separator style, ends the shared path.
      if (rest === null || rest === '' || separator(m.name) !== sep) return current;
      const first = firstSegment(rest, m.name);
      if (segment === null) segment = first;
      else if (segment !== first) return current;
    }
    if (segment === null) return current;
    current = join(current, segment, members[0].name);
  }
}

export function membersUnder<T extends NamedMetric>(metrics: T[], prefix: string): T[] {
  return metrics.filter((m) => remainder(m.name, prefix) !== null);
}

function metricEntry<T extends NamedMetric>(metric: T, prefix: string): MetricEntry<T> {
  const rest = remainder(metric.name, prefix);
  // A metric that is its own prefix has nothing after it; label it with its last segment.
  const label = rest ? rest : metric.name.slice(metric.name.lastIndexOf(separator(metric.name)) + 1) || metric.name;
  return { kind: 'metric', metric, label };
}

/** The entries of one level of the tree. `prefix` is '' for the top. */
export function browse<T extends NamedMetric>(metrics: T[], prefix = ''): Level<T> {
  const members = membersUnder(metrics, prefix);
  const start = collapse(members, prefix);

  const entries: MetricEntry<T>[] = [];
  if (members.length <= FLAT_LIMIT) {
    for (const m of members) entries.push(metricEntry(m, start));
  } else {
    const groups = new Map<string, T[]>();
    for (const m of members) {
      const rest = remainder(m.name, start);
      // A metric that is its own prefix is listed in place, never as a group of one.
      const key = rest === '' || rest === null ? '' : firstSegment(rest, m.name);
      const list = groups.get(key);
      if (list) list.push(m);
      else groups.set(key, [m]);
    }
    for (const [key, list] of groups) {
      if (key === '' || list.length <= INLINE_GROUP) {
        for (const m of list) entries.push(metricEntry(m, start));
        continue;
      }
      const groupPrefix = collapse(list, join(start, key, list[0].name));
      entries.push({ kind: 'group', prefix: groupPrefix, label: start === '' ? groupPrefix : groupPrefix.slice(start.length + 1), count: list.length });
    }
  }

  // Groups first, like folders; each side in a case-insensitive order.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1;
    return compareNames(a.label, b.label);
  });
  return { prefix: start, total: members.length, entries };
}

/** Case-insensitive substring match on full names, in a case-insensitive order. */
export function searchMetrics<T extends NamedMetric>(metrics: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return metrics.filter((m) => m.name.toLowerCase().includes(q)).sort((a, b) => compareNames(a.name, b.name));
}
