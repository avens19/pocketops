import { describe, expect, it } from 'vitest';

import waterfall from './signoz/fixtures/waterfall.json';
import { barGeometry, buildTree, descendantCounts, firstErrorSpan, parseWaterfall, serviceColor, visibleSpans, type FlatSpan } from './trace';

const trace = parseWaterfall('2e07a1ae04581839a4ea0f0e6248e14a', waterfall.data);

describe('parseWaterfall', () => {
  it('reads the summary and keeps server order', () => {
    expect(trace.totalSpans).toBe(8);
    expect(trace.errorSpans).toBe(5);
    expect(trace.rootService).toBe('gateway');
    expect(trace.rootName).toBe('POST /api/checkout');
    expect(trace.spans.map((s) => s.level)).toEqual([0, 1, 2, 3, 2, 3, 4, 4]);
    expect(trace.truncated).toBe(false);
  });

  it('carries attributes, resources and exception events', () => {
    const checkout = trace.spans[1];
    expect(checkout.service).toBe('checkout');
    expect(checkout.attributes['http.response.status_code']).toBe('502');
    expect(checkout.resources['k8s.pod.name']).toMatch(/^checkout-/);
    expect(checkout.events[0]).toMatchObject({ name: 'exception', isError: true });
    expect(checkout.events[0].attributes['exception.type']).toBe('UpstreamTimeoutError');
  });

  it('converts nanoseconds to milliseconds', () => {
    expect(trace.spans[0].durationMs).toBe(221);
    expect(trace.endMs - trace.startMs).toBeGreaterThanOrEqual(221);
  });

  it('survives an empty or odd response', () => {
    expect(parseWaterfall('x', undefined).spans).toEqual([]);
    expect(parseWaterfall('x', { spans: null }).totalSpans).toBe(0);
  });
});

describe('collapsing', () => {
  it('hides a whole subtree and nothing after it', () => {
    const payments = trace.spans[4]; // payments.charge, level 2, has 3 descendants
    const shown = visibleSpans(trace.spans, new Set([payments.id]));
    expect(shown.map((s) => s.name)).toEqual(['POST /api/checkout', 'POST /api/checkout', 'inventory.reserve', 'GET stock:*', 'payments.charge']);
  });

  it('counts descendants', () => {
    const counts = descendantCounts(trace.spans);
    expect(counts.get(trace.spans[0].id)).toBe(7);
    expect(counts.get(trace.spans[4].id)).toBe(3);
    expect(counts.get(trace.spans[3].id)).toBeUndefined();
  });
});

describe('descendantCounts at scale', () => {
  it('matches the quadratic definition on a deep random tree and stays fast', () => {
    const levels = [0];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 1; i < 2000; i++) levels.push(Math.max(1, Math.min(levels[i - 1] + (rand() < 0.6 ? 1 : -Math.floor(rand() * 4)), 400)));
    const spans = levels.map((level, i) => ({ ...trace.spans[0], id: `s${i}`, level }));
    const started = Date.now();
    const fast = descendantCounts(spans);
    expect(Date.now() - started).toBeLessThan(50);
    spans.forEach((s, i) => {
      let n = 0;
      for (let j = i + 1; j < spans.length && spans[j].level > s.level; j++) n++;
      expect(fast.get(s.id) ?? 0).toBe(n);
    });
  });
});

describe('firstErrorSpan', () => {
  it('finds the deepest failing span, where the failure began', () => {
    expect(firstErrorSpan(trace.spans)?.level).toBe(4);
    expect(firstErrorSpan(trace.spans)?.name).toBe('POST api.stripe.com/v1/charges');
  });
  it('is undefined for a clean trace', () => {
    expect(firstErrorSpan(trace.spans.filter((s) => !s.hasError))).toBeUndefined();
  });
});

describe('barGeometry', () => {
  it('places the root across the full width', () => {
    expect(barGeometry(trace.spans[0], trace)).toMatchObject({ left: 0 });
    expect(barGeometry(trace.spans[0], trace).width).toBeGreaterThan(0.9);
  });
  it('never returns an invisible or overflowing bar', () => {
    for (const s of trace.spans) {
      const { left, width } = barGeometry(s, trace);
      expect(width).toBeGreaterThanOrEqual(0.004);
      expect(left + width).toBeLessThanOrEqual(1.0000001);
    }
  });
});

describe('buildTree (fallback)', () => {
  const span = (id: string, parentId: string, startMs: number, extra: Partial<FlatSpan> = {}): FlatSpan => ({
    id, parentId, name: id, service: 's', kind: 'Internal', startMs, durationMs: 1, hasError: false, statusMessage: '', ...extra,
  });

  it('orders depth-first with children by start time', () => {
    const t = buildTree('t', [span('c2', 'a', 30), span('a', '', 0), span('b', 'a', 10), span('c1', 'b', 12)]);
    expect(t.spans.map((s) => `${s.level}:${s.id}`)).toEqual(['0:a', '1:b', '2:c1', '1:c2']);
    expect(t.spans[0].hasChildren).toBe(true);
    expect(t.hasMissingSpans).toBe(false);
  });

  it('flags and roots a span whose parent never arrived', () => {
    const t = buildTree('t', [span('a', '', 0), span('orphan', 'gone', 5)]);
    expect(t.hasMissingSpans).toBe(true);
    expect(t.spans.filter((s) => s.level === 0)).toHaveLength(2);
  });
});

describe('serviceColor', () => {
  it('is stable per name and differs between common names', () => {
    expect(serviceColor('checkout')).toBe(serviceColor('checkout'));
    expect(new Set(['gateway', 'checkout', 'payments', 'inventory', 'notifier'].map(serviceColor)).size).toBeGreaterThan(2);
  });
});
