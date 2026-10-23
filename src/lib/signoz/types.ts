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
  /** One line: the text, or for a structured body its message plus a few fields. */
  body: string;
  /** The log's message: plain text, or a structured body's `message`. Leads a list row. */
  headline: string;
  /** A few telling fields beside the message, for a quieter second line (may be empty). */
  details: string;
  /** The whole body, readable (pretty JSON for a structured body). */
  bodyPretty: string;
  /** A structured body's fields by dotted path, when it has any. */
  bodyFields?: Record<string, string>;
  /** The server returned the body as an object, so its fields can be filtered on as `body.<key>`. */
  bodyFilterable: boolean;
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
