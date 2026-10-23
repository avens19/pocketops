export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '–';
  const pct = fraction * 100;
  if (pct === 0) return '0%';
  return pct < 0.1 ? '<0.1%' : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  if (abs === 0) return '0';
  return v.toPrecision(2);
}

export function timeAgo(input: string | number, now = Date.now()): string {
  const t = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatTime(input: string | number): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * A metric value in its own unit. SigNoz reports UCUM-ish units: `By` bytes, `ms`/`s`/`ns`/`us`, `%`, and `1` for a plain ratio or count.
 * Unknown units fall back to a compact number.
 */
export function formatUnit(value: number, unit: string | undefined): string {
  if (!Number.isFinite(value)) return '–';
  switch ((unit ?? '').trim()) {
    case 'By':
    case 'bytes': {
      let v = Math.abs(value);
      let i = 0;
      while (v >= 1024 && i < BYTE_UNITS.length - 1) {
        v /= 1024;
        i++;
      }
      const text = i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2);
      return `${value < 0 ? '-' : ''}${text} ${BYTE_UNITS[i]}`;
    }
    case 'By/s':
      return `${formatUnit(value, 'By')}/s`;
    case 'ns':
      return formatDuration(value / 1e6);
    case 'us':
    case 'µs':
      return formatDuration(value / 1e3);
    case 'ms':
      return formatDuration(value);
    case 's':
      return formatDuration(value * 1000);
    case '%':
      return `${formatValue(value)}%`;
    default:
      return formatValue(value);
  }
}
