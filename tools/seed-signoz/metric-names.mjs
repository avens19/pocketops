// Emits a few hundred differently-named gauges so the Metrics tab's folder browsing has something realistic to group:
// dotted OpenTelemetry names, mixed case, Prometheus-style underscored names and a few strays.
//   node tools/seed-signoz/metric-names.mjs [--otlp http://localhost:4318]
const OTLP = process.argv.includes('--otlp') ? process.argv[process.argv.indexOf('--otlp') + 1] : 'http://localhost:4318';

const names = [];
const family = (prefix, leaves) => leaves.forEach((l) => names.push(`${prefix}.${l}`));
family('http.server', ['request.duration', 'request.body.size', 'response.body.size', 'active_requests', 'request.count', 'error.count', 'connections.open', 'connections.idle', 'tls.handshake.duration', 'queue.depth', 'retries', 'timeouts']);
family('http.client', ['request.duration', 'request.body.size', 'response.body.size', 'connection.duration', 'open_connections', 'request.count', 'retries']);
family('db.client', ['connections.usage', 'connections.max', 'connections.idle', 'connections.pending', 'connections.timeouts', 'connections.wait_time', 'connections.use_time', 'operation.duration', 'operation.count', 'rows.returned', 'rows.affected', 'cache.hits', 'cache.misses', 'deadlocks', 'replication.lag']);
family('jvm.memory', ['used', 'committed', 'limit', 'init', 'used_after_last_gc']);
family('jvm.gc', ['duration', 'count', 'time']);
family('jvm.thread', ['count', 'daemon', 'peak', 'started']);
family('jvm.class', ['loaded', 'unloaded', 'count']);
family('Process.Runtime.Go', ['goroutines', 'heap.alloc', 'heap.idle', 'heap.inuse', 'heap.objects', 'gc.count', 'gc.pause_total', 'cgo.calls']);
family('process', ['cpu.time', 'cpu.utilization', 'memory.usage', 'memory.virtual', 'open_file_descriptors', 'threads', 'uptime']);
family('system.cpu', ['time', 'utilization', 'load_average.1m', 'load_average.5m', 'load_average.15m', 'frequency', 'logical.count', 'physical.count']);
family('system.memory', ['usage', 'utilization', 'limit', 'linux.available', 'linux.shared', 'linux.slab.reclaimable']);
family('system.disk', ['io', 'io_time', 'operations', 'operation_time', 'pending_operations', 'merged']);
family('system.filesystem', ['usage', 'utilization', 'inodes.usage']);
family('system.network', ['io', 'packets', 'errors', 'dropped', 'connections']);
family('kafka.consumer', ['lag', 'records_consumed', 'fetch.latency', 'commit.rate', 'rebalance.count']);
family('kafka.producer', ['record_send_rate', 'batch_size', 'request_latency', 'buffer_available']);
family('messaging.process', ['duration', 'messages']);
family('rpc.server', ['duration', 'request.size', 'response.size', 'requests_per_rpc']);
for (const m of ['cpu_seconds_total', 'memory_MemAvailable_bytes', 'memory_MemTotal_bytes', 'load1', 'load5', 'load15', 'boot_time_seconds', 'filefd_allocated', 'netstat_Tcp_CurrEstab', 'procs_running', 'procs_blocked', 'context_switches_total', 'intr_total', 'disk_io_now', 'network_receive_bytes_total', 'network_transmit_bytes_total', 'time_seconds', 'uname_info'].map((s) => `node_${s}`)) names.push(m);
for (const m of ['alloc_bytes', 'goroutines', 'gc_duration_seconds', 'heap_objects', 'threads', 'info']) names.push(`go_${m}`);
for (const m of ['requests_total', 'request_duration_seconds', 'requests_in_flight']) names.push(`promhttp_metric_handler_${m}`);
names.push('uptime', 'Build.Info', 'build.version');

const now = Date.now();
const ts = (t) => String(t * 1_000_000);
const metrics = names.map((name, i) => ({
  name,
  unit: /bytes|size|memory|usage/i.test(name) ? 'By' : /duration|seconds|time/i.test(name) ? 's' : '1',
  gauge: { dataPoints: [60, 30, 0].map((m, j) => ({ timeUnixNano: ts(now - m * 1000), asDouble: 10 + ((i * 7 + j * 3) % 40) })) },
}));
const res = await fetch(`${OTLP}/v1/metrics`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ resourceMetrics: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'gateway' } }] }, scopeMetrics: [{ scope: { name: 'demo' }, metrics }] }] }),
});
console.log(`${names.length} metric names -> ${res.status}`);
