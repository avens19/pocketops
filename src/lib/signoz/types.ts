export type AlertState = 'firing' | 'pending' | 'recovering' | 'nodata' | 'inactive' | 'disabled';

export interface Rule {
  id: string;
  name: string;
  state: AlertState;
  severity?: string;
  labels: Record<string, string>;
  alertType?: string;
  description?: string;
  disabled: boolean;
  updatedAt?: string;
}

export interface FiringAlert {
  fingerprint: string;
  ruleName: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  state: string;
  silenced: boolean;
}

export interface TimelineItem {
  unixMilli: number;
  state: AlertState;
  value: number;
  labels: Record<string, string>;
  stateChanged: boolean;
}

export interface LogRow {
  id: string;
  timestamp: string;
  body: string;
  severity: string;
  service?: string;
  traceId?: string;
  attributes: Record<string, string>;
  resources: Record<string, string>;
}

export interface ServiceStat {
  name: string;
  calls: number;
  errors: number;
  /** p99 duration in milliseconds. */
  p99Ms: number;
}

export interface Point {
  t: number;
  v: number;
}

export interface Series {
  name: string;
  labels: Record<string, string>;
  points: Point[];
}

export interface MetricInfo {
  name: string;
  type: string;
  unit: string;
  description: string;
  temporality: string;
  isMonotonic: boolean;
}

export interface QueryRangeData {
  type?: string;
  data?: { results?: unknown[] | null };
}
