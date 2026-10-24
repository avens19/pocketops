import { describe, expect, it } from 'vitest';

import { browse, compareNames, FLAT_LIMIT, searchMetrics } from './metric-tree';

const m = (...names: string[]) => names.map((name) => ({ name }));
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `${prefix}.m${i}` }));
const labels = (level: ReturnType<typeof browse>) => level.entries.map((e) => `${e.kind === 'group' ? '▸' : ''}${e.label}`);

describe('compareNames', () => {
  it('sorts without regard to case', () => {
    const names = ['zeta', 'Alpha', 'beta', 'Beta', 'alpha'].sort(compareNames);
    expect(names).toEqual(['Alpha', 'alpha', 'Beta', 'beta', 'zeta']);
  });
});

describe('browse', () => {
  it('shows a small set flat', () => {
    const level = browse(m('b.x', 'a.y', 'A.z'));
    expect(level.entries.every((e) => e.kind === 'metric')).toBe(true);
    expect(labels(level)).toEqual(['a.y', 'A.z', 'b.x']);
  });

  it('groups a large set by first segment, groups first, and counts members', () => {
    const level = browse([...many('http', 20), ...many('db', 10), ...m('uptime')]);
    expect(labels(level)).toEqual(['▸db', '▸http', 'uptime']);
    const http = level.entries.find((e) => e.kind === 'group' && e.label === 'http');
    expect(http).toMatchObject({ prefix: 'http', count: 20 });
  });

  it('opens a group to its metrics, labelled by what follows the prefix', () => {
    const all = [...many('http', 20), ...many('db', 10)];
    const level = browse(all, 'db');
    expect(level.prefix).toBe('db');
    expect(level.total).toBe(10);
    expect(labels(level)[0]).toBe('m0');
  });

  it('collapses a chain of single-child levels, at the top and inside', () => {
    const all = [...many('apollo.router.cache', 10), ...many('apollo.router.jobs', 10), ...m('apollo.router.size')];
    const top = browse(all);
    expect(top.prefix).toBe('apollo.router');
    expect(labels(top)).toEqual(['▸cache', '▸jobs', 'size']);
    const deep = [...many('a.b.c.d', 20), ...many('a.b.x', 3)];
    const level = browse(deep, 'a');
    expect(level.prefix).toBe('a.b');
    const chain = level.entries.find((e) => e.kind === 'group' && e.count === 20);
    expect(chain).toMatchObject({ label: 'c.d', prefix: 'a.b.c.d' });
  });

  it('lists tiny groups in place instead of making a folder of two', () => {
    const level = browse([...many('big', FLAT_LIMIT + 1), ...m('tiny.one', 'tiny.two')]);
    expect(labels(level)).toEqual(['▸big', 'tiny.one', 'tiny.two']);
  });

  it('keeps a metric that is also a prefix of others', () => {
    const all = [...m('http.server'), ...many('http.server', 20)];
    const level = browse(all, 'http.server');
    expect(level.total).toBe(21);
    expect(labels(level)).toContain('server');
    expect(browse(all).prefix).toBe('http.server');
  });

  it('splits Prometheus-style names on underscores when there are no dots', () => {
    const all = [...Array.from({ length: 20 }, (_, i) => ({ name: `node_cpu_seconds_${i}` })), ...Array.from({ length: 20 }, (_, i) => ({ name: `go_gc_${i}` }))];
    const top = browse(all);
    expect(labels(top)).toEqual(['▸go_gc', '▸node_cpu_seconds']);
    expect(browse(all, 'go_gc').entries).toHaveLength(20);
  });

  it('does not mistake a longer segment for the prefix', () => {
    const all = [...many('http', 20), ...m('httpx.a', 'httpx.b', 'httpx.c')];
    expect(browse(all, 'http').total).toBe(20);
  });

  it('handles empty input and one metric', () => {
    expect(browse([]).entries).toEqual([]);
    expect(labels(browse(m('only.one')))).toEqual(['only.one']);
  });
});

describe('searchMetrics', () => {
  it('matches case-insensitively anywhere in the name and sorts case-insensitively', () => {
    const found = searchMetrics(m('b.Http', 'a.HTTP.x', 'c.db'), 'http');
    expect(found.map((x) => x.name)).toEqual(['a.HTTP.x', 'b.Http']);
  });
});
