// A stand-in for the parts of SigNoz's API that PocketOps uses, shaped after docs/api/openapi.yml in the
// SigNoz repo. It exists so the app can be exercised without a real instance; it is NOT a faithful
// SigNoz, so a pass here proves the app agrees with the spec, not with a running server.
//
//   node tools/mock-signoz/server.mjs [port]      key: test-key
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 3301);
const KEY = 'test-key';
const now = () => Date.now();

const rules = [
  { id: 'r1', alert: 'High error rate on checkout', state: 'firing', alertType: 'TRACES_BASED_ALERT', ruleType: 'threshold_rule', labels: { severity: 'critical', team: 'payments' }, description: 'Error rate above 5% for 5 minutes' },
  { id: 'r2', alert: 'Disk usage above 85%', state: 'pending', alertType: 'METRIC_BASED_ALERT', ruleType: 'threshold_rule', labels: { severity: 'warning' }, description: 'Node disk nearly full' },
  { id: 'r3', alert: 'Error logs spike', state: 'inactive', alertType: 'LOGS_BASED_ALERT', ruleType: 'threshold_rule', labels: { severity: 'error' } },
  { id: 'r4', alert: 'Old experiment', state: 'inactive', alertType: 'METRIC_BASED_ALERT', ruleType: 'threshold_rule', labels: {}, disabled: true },
];

const services = [
  { name: 'checkout', calls: 18234, errors: 1190, p99: 920e6 },
  { name: 'frontend', calls: 52011, errors: 210, p99: 310e6 },
  { name: 'payments', calls: 9120, errors: 3, p99: 140e6 },
  { name: 'worker', calls: 640, errors: 0, p99: 4800e6 },
];

const levels = ['INFO', 'INFO', 'WARN', 'ERROR', 'DEBUG', 'INFO'];
const bodies = [
  'GET /api/cart 200 12ms',
  'cache miss for key cart:42',
  'retrying upstream call (attempt 2)',
  'payment provider returned 502: bad gateway',
  'loaded config from /etc/app.yaml',
  'POST /api/checkout 201 88ms',
];
function logRow(i, base) {
  const ts = new Date(base - i * 7000).toISOString();
  return {
    timestamp: ts,
    data: {
      id: `log-${i}`,
      body: `${bodies[i % bodies.length]} #${i}`,
      severity_text: levels[i % levels.length],
      trace_id: i % 3 === 0 ? 'a1b2c3d4e5f60718293a4b5c6d7e8f90' : '',
      resources_string: { 'service.name': services[i % services.length].name, 'k8s.pod.name': `pod-${i % 4}` },
      attributes_string: { 'http.route': '/api/cart', env: 'prod' },
      attributes_number: { 'http.status_code': i % 6 === 3 ? 502 : 200 },
    },
  };
}

function series(start, end, step, fn, labels = []) {
  const values = [];
  for (let t = start; t <= end; t += step * 1000) values.push({ timestamp: t, value: fn(t) });
  return { labels, values };
}

function queryRange(body) {
  const q = body.compositeQuery.queries[0];
  const spec = q.spec;
  const type = body.requestType;
  const filter = spec.filter?.expression ?? '';
  const service = filter.match(/service\.name = '([^']+)'/)?.[1];

  if (type === 'raw' && spec.signal === 'logs') {
    const idMatch = filter.match(/id = '([^']+)'/)?.[1];
    if (idMatch) {
      const n = Number(idMatch.replace('log-', ''));
      return { type, data: { results: [{ queryName: 'A', rows: [logRow(n, now())] }] } };
    }
    const text = filter.match(/body CONTAINS '([^']+)'/)?.[1];
    const wanted = filter.match(/severity_text IN \(([^)]+)\)/)?.[1];
    let rows = Array.from({ length: 400 }, (_, i) => logRow(i, now()));
    if (text) rows = rows.filter((r) => r.data.body.includes(text));
    if (wanted) rows = rows.filter((r) => wanted.includes(`'${r.data.severity_text}'`));
    if (service) rows = rows.filter((r) => r.data.resources_string['service.name'] === service);
    const offset = spec.offset ?? 0;
    return { type, data: { results: [{ queryName: 'A', rows: rows.slice(offset, offset + (spec.limit ?? 50)) }] } };
  }

  if (type === 'raw' && spec.signal === 'traces') {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(now() - i * 60000).toISOString(),
      data: { name: i % 2 ? 'POST /charge' : 'GET /cart', trace_id: `trace${i}`, duration_nano: (200 + i * 90) * 1e6, status_message: 'upstream 502' },
    }));
    return { type, data: { results: [{ queryName: 'A', rows }] } };
  }

  if (type === 'scalar' && spec.signal === 'traces') {
    const grouped = spec.groupBy?.[0]?.name;
    const nAgg = spec.aggregations?.length ?? 3;
    const rows = (
      grouped === 'name'
        ? [['GET /cart', 9000, 40, 300e6], ['POST /charge', 4000, 1100, 1200e6], ['GET /health', 5000, 0, 5e6]]
        : grouped && grouped !== 'service.name'
          ? [['/api/cart', 9000, 0, 0], ['/api/checkout', 4000, 0, 0], ['/api/health', 5000, 0, 0]]
          : services.map((s) => [s.name, s.calls, s.errors, s.p99])
    ).map((r) => r.slice(0, 1 + nAgg));
    return {
      type,
      data: {
        results: [{
          queryName: 'A',
          columns: [
            { name: grouped ?? 'service.name', columnType: 'group' },
            ...Array.from({ length: nAgg }, (_, i) => ({ name: `__result_${i}`, columnType: 'aggregation', aggregationIndex: i })),
          ],
          data: rows,
        }],
      },
    };
  }

  if (type === 'time_series') {
    const step = typeof spec.stepInterval === 'number' ? spec.stepInterval : 60;
    const end = body.end;
    const start = body.start;
    const wave = (base, amp) => (t) => base + amp * Math.sin(t / 600000);
    if (spec.signal === 'traces') {
      return {
        type,
        data: {
          results: [{
            queryName: 'A',
            aggregations: [
              { index: 0, alias: 'calls', series: [series(start, end, step, wave(step * 8, step * 3))] },
              { index: 1, alias: 'errors', series: [series(start, end, step, wave(step * 0.6, step * 0.5))] },
              { index: 2, alias: 'p99', series: [series(start, end, step, wave(600e6, 300e6))] },
            ],
          }],
        },
      };
    }
    const groupName = spec.groupBy?.[0]?.name;
    const groups = groupName ? ['checkout', 'frontend', 'payments'] : [null];
    return {
      type,
      data: {
        results: [{
          queryName: 'A',
          aggregations: [{
            index: 0,
            series: groups.map((g, i) =>
              series(start, end, step, wave(40 + i * 15, 12), g ? [{ key: { name: groupName }, value: g }] : []),
            ),
          }],
        }],
      },
    };
  }
  return { type, data: { results: [] } };
}

const routes = {
  'GET /api/v1/service_accounts/me': () => ({ id: 'sa-1', name: 'pocketops', status: 'active' }),
  'GET /api/v3/rules': () => ({ rules, total: rules.length, labels: [], reservedKeywords: [] }),
  'GET /api/v1/alerts': () => [
    { fingerprint: 'f1', labels: { alertname: 'High error rate on checkout', severity: 'critical', service: 'checkout', ruleId: 'r1' }, annotations: { summary: 'checkout error rate is 6.5%' }, startsAt: new Date(now() - 18 * 60000).toISOString(), status: { state: 'active', silencedBy: [] } },
    { fingerprint: 'f2', labels: { alertname: 'High error rate on checkout', severity: 'critical', service: 'payments', ruleId: 'r1' }, annotations: {}, startsAt: new Date(now() - 6 * 60000).toISOString(), status: { state: 'active', silencedBy: ['s1'] } },
  ],
  'GET /api/v2/metrics': () => ({
    metrics: [
      { metricName: 'system.cpu.utilization', description: '', type: 'gauge', unit: 'percent', temporality: 'unspecified', isMonotonic: false },
      { metricName: 'http.server.request.count', description: '', type: 'sum', unit: '', temporality: 'cumulative', isMonotonic: true },
      { metricName: 'http.server.duration', description: '', type: 'histogram', unit: 'ms', temporality: 'delta', isMonotonic: false },
    ],
  }),
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  console.log(req.method, url.pathname + url.search.slice(0, 80));

  if (req.headers['signoz-api-key'] !== KEY) {
    return send(401, { status: 'error', error: { code: 'unauthenticated', message: 'invalid or missing API key' } });
  }

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    try {
      if (req.method === 'POST' && url.pathname === '/api/v5/query_range') {
        return send(200, { status: 'success', data: queryRange(JSON.parse(raw)) });
      }
      const timeline = url.pathname.match(/^\/api\/v2\/rules\/([^/]+)\/history\/timeline$/);
      if (req.method === 'GET' && timeline) {
        const items = [
          { ruleId: timeline[1], ruleName: 'x', state: 'firing', stateChanged: true, overallState: 'firing', overallStateChanged: true, unixMilli: now() - 18 * 60000, value: 6.5, labels: [], fingerprint: 1 },
          { ruleId: timeline[1], ruleName: 'x', state: 'inactive', stateChanged: true, overallState: 'inactive', overallStateChanged: true, unixMilli: now() - 3 * 3600000, value: 0.4, labels: [], fingerprint: 1 },
          { ruleId: timeline[1], ruleName: 'x', state: 'firing', stateChanged: true, overallState: 'firing', overallStateChanged: true, unixMilli: now() - 5 * 3600000, value: 7.1, labels: [], fingerprint: 1 },
        ];
        return send(200, { status: 'success', data: { items, total: items.length } });
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) return send(200, { status: 'success', data: handler() });
      return send(404, { status: 'error', error: { code: 'not_found', message: 'not found' } });
    } catch (e) {
      return send(400, { status: 'error', error: { code: 'bad_request', message: String(e) } });
    }
  });
}).listen(PORT, '0.0.0.0', () => console.log(`mock SigNoz on :${PORT}  (key: ${KEY})`));
