// Seeds a local SigNoz with believable multi-service telemetry over OTLP/HTTP so PocketOps has real data to browse.
//
//   node tools/seed-signoz/seed.mjs [--hours 6] [--otlp http://localhost:4318] [--live]
//
// --hours   backfill this many hours of history (default 6)
// --live    after the backfill, keep emitting one fresh batch every 10s until interrupted
//
// Topology: gateway -> checkout -> (payments -> postgres, stripe) + inventory -> redis, plus a notifier worker.
// Errors are injected on a schedule (a payments incident ~90 minutes ago, a steady trickle elsewhere) so the
// error-rate, p99 and "find the failing span" flows have something to find. Every log carries trace_id/span_id.
import { randomBytes } from 'node:crypto';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};
const OTLP = arg('otlp', 'http://localhost:4318');
const HOURS = Number(arg('hours', 6));
const LIVE = process.argv.includes('--live');

const hex = (bytes) => randomBytes(bytes).toString('hex');
const rnd = (min, max) => min + Math.random() * (max - min);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const ms = (n) => Math.round(n * 1e6);
const nano = (t) => String(BigInt(Math.round(t)) * 1000000n);

const ENV = 'production';
const strAttr = (key, value) => ({ key, value: { stringValue: String(value) } });
const intAttr = (key, value) => ({ key, value: { intValue: String(Math.round(value)) } });
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => (typeof v === 'number' ? (Number.isInteger(v) ? intAttr(k, v) : { key: k, value: { doubleValue: v } }) : typeof v === 'boolean' ? { key: k, value: { boolValue: v } } : strAttr(k, v)));

const SERVICES = {
  gateway: { version: '3.4.1', pods: ['gateway-7c9d-x2k4p', 'gateway-7c9d-m8q1z'], lang: 'nodejs' },
  checkout: { version: '2.17.0', pods: ['checkout-5b8f-hn4rt', 'checkout-5b8f-p2v9w', 'checkout-5b8f-c7d3s'], lang: 'java' },
  payments: { version: '1.9.4', pods: ['payments-66d4-lq8vb', 'payments-66d4-z5t2n'], lang: 'go' },
  inventory: { version: '4.2.0', pods: ['inventory-84cc-j6w3r'], lang: 'python' },
  notifier: { version: '0.8.2', pods: ['notifier-9f7b-k1x8d'], lang: 'python' },
};
const resource = (service, pod) => ({
  attributes: attrs({
    'service.name': service,
    'service.version': SERVICES[service].version,
    'deployment.environment': ENV,
    'k8s.namespace.name': ENV,
    'k8s.pod.name': pod,
    'k8s.cluster.name': 'prod-east',
    'host.name': `node-${pod.slice(-2)}`,
    'telemetry.sdk.language': SERVICES[service].lang,
  }),
});

const ROUTES = [
  { method: 'POST', route: '/api/checkout', weight: 5 },
  { method: 'GET', route: '/api/cart', weight: 9 },
  { method: 'GET', route: '/api/products/:id', weight: 12 },
  { method: 'POST', route: '/api/cart/items', weight: 6 },
  { method: 'GET', route: '/api/orders/:id', weight: 4 },
];
const weighted = () => {
  const total = ROUTES.reduce((s, r) => s + r.weight, 0);
  let x = Math.random() * total;
  for (const r of ROUTES) if ((x -= r.weight) <= 0) return r;
  return ROUTES[0];
};
const USERS = Array.from({ length: 40 }, (_, i) => `user-${1000 + i}`);

// Buffers keyed by service+pod so each OTLP resource block is emitted once per flush.
const spanBuf = new Map();
const logBuf = new Map();
const bufKey = (service, pod) => `${service}|${pod}`;
const pushTo = (map, service, pod, item) => {
  const k = bufKey(service, pod);
  if (!map.has(k)) map.set(k, { service, pod, items: [] });
  map.get(k).items.push(item);
};

function span(ctx, service, pod, { name, kind, start, dur, parent, error, attributes = {}, events = [] }) {
  const id = hex(8);
  pushTo(spanBuf, service, pod, {
    traceId: ctx.traceId,
    spanId: id,
    parentSpanId: parent ?? '',
    name,
    kind,
    startTimeUnixNano: nano(start),
    endTimeUnixNano: nano(start + dur),
    attributes: attrs(attributes),
    status: error ? { code: 2, message: error } : { code: 0 },
    events: events.map((e) => ({ timeUnixNano: nano(e.at), name: e.name, attributes: attrs(e.attributes) })),
  });
  return id;
}

const SEV = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 };
function log(ctx, service, pod, at, severity, body, attributes = {}, spanId = '') {
  pushTo(logBuf, service, pod, {
    timeUnixNano: nano(at),
    observedTimeUnixNano: nano(at),
    severityNumber: SEV[severity],
    severityText: severity,
    body: { stringValue: body },
    attributes: attrs(attributes),
    traceId: ctx?.traceId ?? '',
    spanId,
  });
}

const PAYMENT_ERRORS = [
  ['card_declined', 'Your card was declined', 'PaymentDeclinedError'],
  ['gateway_timeout', 'upstream stripe request timed out after 3000ms', 'UpstreamTimeoutError'],
  ['insufficient_funds', 'Insufficient funds', 'PaymentDeclinedError'],
];

// One end-to-end request. `incident` raises the payments failure rate; `slow` stretches durations.
function request(t, { incident }) {
  const ctx = { traceId: hex(16) };
  const { method, route } = weighted();
  const user = pick(USERS);
  const gwPod = pick(SERVICES.gateway.pods);
  const coPod = pick(SERVICES.checkout.pods);
  const payPod = pick(SERVICES.payments.pods);
  const invPod = pick(SERVICES.inventory.pods);
  const isCheckout = route === '/api/checkout';
  const base = rnd(8, 40) * (route === '/api/products/:id' ? 0.6 : 1);

  let failure = null; // { status, message, type, where }
  let payDur = 0;
  let payOk = true;
  if (isCheckout) {
    const bad = Math.random() < (incident ? 0.45 : 0.03);
    payDur = incident && Math.random() < 0.6 ? rnd(2800, 3400) : rnd(60, 240);
    if (bad) {
      payOk = false;
      const [code, message, type] = incident && payDur > 2500 ? PAYMENT_ERRORS[1] : pick(PAYMENT_ERRORS);
      failure = { status: type === 'PaymentDeclinedError' ? 402 : 502, message, type, code };
    }
  } else if (Math.random() < 0.012) {
    failure = { status: 500, message: 'unexpected null in cart serializer', type: 'TypeError', code: 'null_ref' };
  }

  const invDur = rnd(6, 30);
  const coWork = rnd(5, 20);
  const total = base + (isCheckout ? payDur + invDur + coWork : invDur + coWork);
  const status = failure?.status ?? (method === 'POST' ? 201 : 200);

  const gwAttrs = { 'http.request.method': method, 'http.route': route, 'http.response.status_code': status, 'url.path': route.replace(':id', String(rnd(1, 9999) | 0)), 'enduser.id': user, 'client.address': `10.4.${(rnd(0, 255)) | 0}.${(rnd(1, 254)) | 0}` };
  const gwSpan = span(ctx, 'gateway', gwPod, {
    name: `${method} ${route}`, kind: 2, start: t, dur: total + 3, error: status >= 500 ? failure.message : null, attributes: gwAttrs,
  });
  log(ctx, 'gateway', gwPod, t + 1, 'INFO', `${method} ${route} started`, { 'http.route': route, 'enduser.id': user }, gwSpan);

  const coStart = t + 2;
  const coSpan = span(ctx, 'checkout', coPod, {
    name: `${method} ${route}`, kind: 2, start: coStart, dur: total - 2, parent: gwSpan, error: status >= 500 ? failure.message : null,
    attributes: { 'http.request.method': method, 'http.route': route, 'http.response.status_code': status, 'enduser.id': user },
    events: failure && status >= 500 ? [{ at: coStart + total - 3, name: 'exception', attributes: { 'exception.type': failure.type, 'exception.message': failure.message, 'exception.stacktrace': `${failure.type}: ${failure.message}\n    at CheckoutHandler.handle (checkout.js:142:19)\n    at Layer.handle (router.js:95:5)` } }] : [],
  });

  // inventory
  const invStart = coStart + 1;
  const invSpan = span(ctx, 'inventory', invPod, { name: 'inventory.reserve', kind: 2, start: invStart, dur: invDur, parent: coSpan, attributes: { 'rpc.system': 'grpc', 'rpc.method': 'Reserve', 'db.system': 'redis' } });
  span(ctx, 'inventory', invPod, { name: 'GET stock:*', kind: 3, start: invStart + 1, dur: invDur * 0.5, parent: invSpan, attributes: { 'db.system': 'redis', 'db.statement': 'GET stock:sku-' + ((rnd(1, 400)) | 0) } });
  log(ctx, 'inventory', invPod, invStart + 2, 'DEBUG', 'stock reserved', { sku: 'sku-' + ((rnd(1, 400)) | 0), qty: (rnd(1, 4)) | 0 }, invSpan);

  if (isCheckout) {
    const payStart = invStart + invDur + 1;
    const callSpan = span(ctx, 'checkout', coPod, { name: 'payments.charge', kind: 3, start: payStart, dur: payDur + 2, parent: coSpan, error: payOk ? null : failure.message, attributes: { 'rpc.system': 'grpc', 'rpc.method': 'Charge' } });
    const paySpan = span(ctx, 'payments', payPod, {
      name: 'payments.Charge', kind: 2, start: payStart + 1, dur: payDur, parent: callSpan, error: payOk ? null : failure.message,
      attributes: { 'rpc.system': 'grpc', 'rpc.method': 'Charge', 'payment.provider': 'stripe', 'payment.amount_cents': (rnd(500, 25000)) | 0, 'payment.currency': 'USD', 'payment.error_code': payOk ? undefined : failure.code, 'enduser.id': user },
      events: payOk ? [] : [{ at: payStart + payDur, name: 'exception', attributes: { 'exception.type': failure.type, 'exception.message': failure.message, 'exception.stacktrace': `${failure.type}: ${failure.message}\n    at charge (payments/charge.go:88)\n    at handler (payments/server.go:41)` } }],
    });
    span(ctx, 'payments', payPod, { name: 'INSERT payments', kind: 3, start: payStart + 3, dur: rnd(4, 14), parent: paySpan, attributes: { 'db.system': 'postgresql', 'db.operation': 'INSERT', 'db.statement': 'INSERT INTO payments (id, user_id, amount_cents, status) VALUES ($1, $2, $3, $4)' } });
    span(ctx, 'payments', payPod, { name: 'POST api.stripe.com/v1/charges', kind: 3, start: payStart + 18, dur: Math.max(payDur - 22, 10), parent: paySpan, error: payOk ? null : failure.message, attributes: { 'http.request.method': 'POST', 'server.address': 'api.stripe.com', 'http.response.status_code': payOk ? 200 : failure.status } });
    if (payOk) log(ctx, 'payments', payPod, payStart + payDur, 'INFO', 'charge succeeded', { 'payment.provider': 'stripe', 'enduser.id': user }, paySpan);
    else log(ctx, 'payments', payPod, payStart + payDur, failure.status >= 500 ? 'ERROR' : 'WARN', `charge failed: ${failure.message}`, { 'payment.error_code': failure.code, 'enduser.id': user, 'payment.provider': 'stripe' }, paySpan);

    if (payOk) {
      const nPod = pick(SERVICES.notifier.pods);
      const nStart = payStart + payDur + 5;
      const nSpan = span(ctx, 'notifier', nPod, { name: 'orders.confirmed process', kind: 5, start: nStart, dur: rnd(20, 90), parent: callSpan, attributes: { 'messaging.system': 'sqs', 'messaging.operation': 'process' } });
      log(ctx, 'notifier', nPod, nStart + 5, 'INFO', 'sent order confirmation email', { 'enduser.id': user, channel: 'email' }, nSpan);
    }
  }

  if (failure && status >= 500) log(ctx, 'checkout', coPod, coStart + total - 3, 'ERROR', `${method} ${route} failed: ${failure.message}`, { 'http.route': route, 'http.response.status_code': status, 'exception.type': failure.type, 'enduser.id': user }, coSpan);
  else if (Math.random() < 0.15) log(ctx, 'checkout', coPod, coStart + 2, 'INFO', `${method} ${route} ${status} in ${Math.round(total)}ms`, { 'http.route': route, 'http.response.status_code': status }, coSpan);
  if (Math.random() < 0.03) log(ctx, 'checkout', coPod, coStart + 4, 'WARN', 'cart cache miss, falling back to database', { 'cache.key': `cart:${user}` }, coSpan);
  return { total, status, service: 'gateway', route, method };
}

function background(t) {
  // Background logs with no trace context: schedulers, health, config reloads.
  const svc = pick(Object.keys(SERVICES));
  const pod = pick(SERVICES[svc].pods);
  const msgs = [
    ['INFO', 'health check ok', { 'http.route': '/healthz' }],
    ['INFO', 'config reloaded', { 'config.version': 'v' + ((rnd(1, 40)) | 0) }],
    ['DEBUG', 'gc pause', { 'gc.pause_ms': Math.round(rnd(2, 40)) }],
    ['WARN', 'connection pool at 85% capacity', { 'pool.name': 'primary', 'pool.size': 20 }],
  ];
  const [sev, body, a] = pick(msgs);
  log(null, svc, pod, t, sev, body, a);
}

const sent = { spans: 0, logs: 0, metrics: 0 };
async function post(path, body) {
  // A timeout so one hung request (the collector restarting) cannot stall a live run forever.
  const res = await fetch(`${OTLP}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
}

async function flushTraces() {
  const resourceSpans = [...spanBuf.values()].map(({ service, pod, items }) => ({ resource: resource(service, pod), scopeSpans: [{ scope: { name: `${service}-instrumentation` }, spans: items }] }));
  spanBuf.clear();
  sent.spans += resourceSpans.reduce((n, r) => n + r.scopeSpans[0].spans.length, 0);
  for (let i = 0; i < resourceSpans.length; i += 20) await post('/v1/traces', { resourceSpans: resourceSpans.slice(i, i + 20) });
}
async function flushLogs() {
  const resourceLogs = [...logBuf.values()].map(({ service, pod, items }) => ({ resource: resource(service, pod), scopeLogs: [{ scope: { name: `${service}-logger` }, logRecords: items }] }));
  logBuf.clear();
  sent.logs += resourceLogs.reduce((n, r) => n + r.scopeLogs[0].logRecords.length, 0);
  for (let i = 0; i < resourceLogs.length; i += 20) await post('/v1/logs', { resourceLogs: resourceLogs.slice(i, i + 20) });
}

// Metrics: per-pod CPU/memory gauges, an http request counter and a latency histogram, 60s resolution.
const counters = new Map();
async function metricsAt(t, { incident }) {
  const resourceMetrics = [];
  for (const [service, def] of Object.entries(SERVICES)) {
    for (const pod of def.pods) {
      const k = `${service}|${pod}`;
      const prev = counters.get(k) ?? 0;
      const reqs = Math.round(rnd(40, 120) * (service === 'gateway' ? 1.5 : 1));
      const errs = Math.round(reqs * (service === 'payments' && incident ? 0.35 : 0.01));
      counters.set(k, prev + reqs);
      const ts = nano(t);
      const startTs = nano(t - 60000);
      const hour = new Date(t).getHours();
      const wave = 0.5 + 0.25 * Math.sin((t / 3600000) * 1.3);
      resourceMetrics.push({
        resource: resource(service, pod),
        scopeMetrics: [{
          scope: { name: 'runtime' },
          metrics: [
            { name: 'process.cpu.utilization', unit: '1', gauge: { dataPoints: [{ timeUnixNano: ts, asDouble: Math.min(0.98, wave * rnd(0.6, 1.1) + (service === 'payments' && incident ? 0.3 : 0)) }] } },
            { name: 'process.memory.usage', unit: 'By', gauge: { dataPoints: [{ timeUnixNano: ts, asInt: String(Math.round(rnd(180, 420) * 1024 * 1024 + hour * 2e6)) }] } },
            { name: 'http.server.request.count', unit: '{request}', sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: [
              { startTimeUnixNano: startTs, timeUnixNano: ts, asInt: String(counters.get(k)), attributes: attrs({ 'http.response.status_class': '2xx' }) },
              { startTimeUnixNano: startTs, timeUnixNano: ts, asInt: String(Math.round(errs)), attributes: attrs({ 'http.response.status_class': '5xx' }) },
            ] } },
          ],
        }],
      });
    }
  }
  await post('/v1/metrics', { resourceMetrics });
}

const incidentAt = (t) => { const mins = (Date.now() - t) / 60000; return mins > 70 && mins < 110; };

async function batch(from, to, perMinute) {
  for (let t = from; t < to; t += 60000) {
    // The last step may be shorter than a minute (a live batch is ~10s): scale the volume and never stamp data after `to`,
    // or a view bounded by "now" would not show it until the clock caught up.
    const span = Math.min(60000, to - t);
    const n = Math.round(perMinute * (span / 60000) * rnd(0.7, 1.3) * (0.6 + 0.4 * Math.sin(t / 2.4e6)));
    for (let i = 0; i < n; i++) request(t + rnd(0, span), { incident: incidentAt(t) });
    for (let i = 0; i < Math.max(1, Math.round(6 * (span / 60000))); i++) background(t + rnd(0, span));
    await metricsAt(t, { incident: incidentAt(t) });
    if (spanBuf.size > 300) { await flushTraces(); await flushLogs(); }
  }
  await flushTraces();
  await flushLogs();
}

const now = Date.now();
console.log(`Backfilling ${HOURS}h to ${OTLP} ...`);
await batch(now - HOURS * 3600000, now, 28);
console.log(`Backfill complete: ${sent.spans} spans, ${sent.logs} logs.`);

if (LIVE) {
  console.log('Live mode: one batch every 10s (Ctrl-C to stop).');
  let last = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const t = Date.now();
    try {
      await batch(last, t, 28);
      last = t;
    } catch (e) {
      // Keep going: the next batch covers the gap once the collector is back.
      console.error(`batch failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
