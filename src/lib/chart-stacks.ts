import type { Series } from './signoz/types';

/** Stack by timestamp, with separate positive/negative baselines. Missing samples remain absent. */
export function stackBars(series: Series[]) {
  const totals = new Map<number, { positive: number; negative: number }>();
  return series.flatMap((s, index) => s.points.map((p) => {
    const total = totals.get(p.t) ?? { positive: 0, negative: 0 };
    const base = p.v < 0 ? total.negative : total.positive;
    if (p.v < 0) total.negative += p.v; else total.positive += p.v;
    totals.set(p.t, total);
    return { t: p.t, base, top: base + p.v, index };
  }));
}
