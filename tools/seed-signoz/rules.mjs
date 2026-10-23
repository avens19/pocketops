// Creates a handful of alert rules in a local SigNoz so the Alerts tab shows firing / pending / inactive / disabled.
//   SIGNOZ_ADMIN_PASSWORD=... node tools/seed-signoz/rules.mjs [--url http://localhost:8080] [--email admin@local.test]
// Needs the local admin login (rules are created with a session token, not the Viewer API key the app uses). The password
// comes from the environment or --password, never from the repo.
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const URL_ = arg('url', 'http://localhost:8080');
const EMAIL = arg('email', 'admin@local.test');
const PASSWORD = arg('password', process.env.SIGNOZ_ADMIN_PASSWORD);
if (!PASSWORD) {
  console.error('Set SIGNOZ_ADMIN_PASSWORD (or pass --password) to the local admin password.');
  process.exit(1);
}

async function call(path, init = {}, token) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const ctx = await call(`/api/v2/sessions/context?email=${encodeURIComponent(EMAIL)}&ref=${encodeURIComponent(URL_)}`);
const orgId = ctx.data.orgs[0].id;
const session = await call('/api/v2/sessions/email_password', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD, orgId }) });
const token = session.data.accessToken;

const group = (name, fieldContext = 'resource') => ({ fieldContext, fieldDataType: 'string', name, signal: '' });
const threshold = (name, op, target, matchType = 'at_least_once') => ({ kind: 'basic', spec: [{ channels: ['slack-prod-alerts'], matchType, name, op, recoveryTarget: null, target, targetUnit: '' }] });
const rule = ({ alert, description, alertType, signal, aggregation, filter, groupBy, thr, labels, disabled = false, evalWindow = '5m' }) => ({
  alert, alertType, ruleType: 'threshold_rule', schemaVersion: 'v2alpha1', version: 'v5', disabled,
  annotations: { description, summary: alert },
  description,
  condition: {
    compositeQuery: { panelType: 'graph', queryType: 'builder', queries: [{ type: 'builder_query', spec: { name: 'A', signal, aggregations: [typeof aggregation === 'string' ? { expression: aggregation } : aggregation], disabled: false, filter: { expression: filter }, groupBy, legend: '', source: '', stepInterval: 60 } }] },
    selectedQueryName: 'A',
    thresholds: thr,
  },
  evaluation: { kind: 'rolling', spec: { evalWindow, frequency: '1m' } },
  labels,
  notificationSettings: { groupBy: groupBy.map((g) => g.name), renotify: { enabled: true, interval: '1h', alertStates: ['firing'] }, usePolicy: false },
});

const rules = [
  rule({ alert: '[production] Checkout errors', alertType: 'LOGS_BASED_ALERT', signal: 'logs', aggregation: 'count()', filter: "service.name = 'checkout' AND severity_text = 'ERROR'", groupBy: [group('service.name')], thr: threshold('critical', 'above', 0), labels: { environment: 'production', severity: 'critical', team: 'checkout' }, description: 'Checkout is logging errors. Look for the failing route and the payments dependency.' }),
  rule({ alert: '[production] Payments provider declines', alertType: 'LOGS_BASED_ALERT', signal: 'logs', aggregation: 'count()', filter: "service.name = 'payments' AND body CONTAINS 'charge failed'", groupBy: [group('service.name'), group('payment.error_code', 'attribute')], thr: threshold('warning', 'above', 0), labels: { environment: 'production', severity: 'warning', team: 'payments' }, description: 'Charges are failing. A burst of gateway_timeout usually means the provider is degraded.', evalWindow: '15m' }),
  rule({ alert: '[production] Inventory cache miss storm', alertType: 'LOGS_BASED_ALERT', signal: 'logs', aggregation: 'count()', filter: "service.name = 'inventory' AND body CONTAINS 'cache miss'", groupBy: [group('service.name')], thr: threshold('warning', 'above', 500), labels: { environment: 'production', severity: 'warning' }, description: 'Inventory is missing its cache.' }),
  rule({ alert: '[production] Gateway p99 latency', alertType: 'TRACES_BASED_ALERT', signal: 'traces', aggregation: 'p99(duration_nano)', filter: "service.name = 'gateway'", groupBy: [group('service.name')], thr: threshold('warning', 'above', 60000000000), labels: { environment: 'production', severity: 'warning' }, description: 'Gateway p99 above one minute.' }),
  rule({ alert: '[production] Pod CPU above 90%', alertType: 'METRIC_BASED_ALERT', signal: 'metrics', aggregation: { metricName: 'process.cpu.utilization', timeAggregation: 'max', spaceAggregation: 'max' }, filter: '', groupBy: [group('k8s.pod.name')], thr: threshold('critical', 'above', 5), labels: { environment: 'production', severity: 'critical' }, description: 'A pod is saturating its CPU.' }),
  rule({ alert: '[staging] Old experiment', alertType: 'LOGS_BASED_ALERT', signal: 'logs', aggregation: 'count()', filter: "body CONTAINS 'experiment'", groupBy: [], thr: threshold('info', 'above', 0), labels: { environment: 'staging', severity: 'info' }, disabled: true, description: 'Disabled; left for reference.' }),
];

const existing = new Set(((await call('/api/v3/rules', {}, token)).data?.rules ?? []).map((r) => r.alert));
for (const r of rules) {
  if (existing.has(r.alert)) { console.log(`exists  ${r.alert}`); continue; }
  const out = await call('/api/v1/rules', { method: 'POST', body: JSON.stringify(r) }, token);
  console.log(`created ${r.alert}  ->  ${out.data?.id ?? JSON.stringify(out).slice(0, 80)}`);
}
