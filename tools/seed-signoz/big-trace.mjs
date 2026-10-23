// Posts one large trace so the waterfall can be tried at scale (rendering, collapse, "Jump to failure" far down the list).
//   node tools/seed-signoz/big-trace.mjs [spans=1800] [otlp=http://localhost:4318]
// Shape: a root, 20 batches under it, each batch a chain of spans; the only error is near the end.
import { randomBytes } from 'node:crypto';

const COUNT = Number(process.argv[2] ?? 1800);
const OTLP = process.argv[3] ?? 'http://localhost:4318';
const hex = (n) => randomBytes(n).toString('hex');
const traceId = hex(16);
const now = Date.now();
const nano = (ms) => String(BigInt(Math.round(ms)) * 1000000n);
const SERVICES = ['gateway', 'checkout', 'payments', 'inventory', 'notifier'];

const spans = [];
const rootId = hex(8);
const total = 4000;
spans.push({ id: rootId, parent: '', name: 'POST /api/bulk-import', service: 'gateway', start: now - total, dur: total, error: false });
const batches = 20;
const perBatch = Math.floor((COUNT - 1 - batches) / batches);
let t = now - total + 5;
for (let b = 0; b < batches; b++) {
  const batchId = hex(8);
  spans.push({ id: batchId, parent: rootId, name: `import.batch.${b}`, service: 'checkout', start: t, dur: perBatch * 2, error: false });
  let parent = batchId;
  for (let i = 0; i < perBatch; i++) {
    const id = hex(8);
    const last = b === batches - 2 && i === perBatch - 2;
    spans.push({ id, parent: i % 7 === 0 ? batchId : parent, name: `row.${b}.${i}`, service: SERVICES[(b + i) % 5], start: t + i * 2, dur: 1 + (i % 5), error: last, message: last ? 'row rejected: duplicate key' : '' });
    parent = id;
  }
  t += perBatch * 2 + 2;
}

const bySvc = new Map();
for (const s of spans) {
  if (!bySvc.has(s.service)) bySvc.set(s.service, []);
  bySvc.get(s.service).push({
    traceId, spanId: s.id, parentSpanId: s.parent, name: s.name, kind: 1,
    startTimeUnixNano: nano(s.start), endTimeUnixNano: nano(s.start + s.dur),
    attributes: [{ key: 'import.row', value: { stringValue: s.name } }],
    status: s.error ? { code: 2, message: s.message } : { code: 0 },
  });
}
const resourceSpans = [...bySvc].map(([service, list]) => ({
  resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }, { key: 'deployment.environment', value: { stringValue: 'production' } }] },
  scopeSpans: [{ scope: { name: 'big-trace' }, spans: list }],
}));
const res = await fetch(`${OTLP}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resourceSpans }) });
console.log(`posted ${spans.length} spans (${res.status}) trace ${traceId}`);
