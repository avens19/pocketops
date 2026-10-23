import { describe, expect, it } from 'vitest';

import { explorerQuery, firstUrl, relativeTimeMs, routeForUrl } from './deeplink';

describe('routeForUrl', () => {
  it('maps SigNoz alert URLs', () => {
    expect(routeForUrl('https://signoz.example.com/alerts/overview?ruleId=abc-123')).toBe('/alerts/abc-123');
    expect(routeForUrl('https://signoz.example.com/alerts')).toBe('/alerts');
  });

  it('maps service pages', () => {
    expect(routeForUrl('https://s.example.com/services/checkout%20api?relativeTime=30m')).toBe('/services/checkout%20api');
  });

  it('maps the app scheme', () => {
    expect(routeForUrl('pocketops://alerts/42')).toBe('/alerts/42');
    expect(routeForUrl('pocketops://logs')).toBe('/logs');
  });

  it('maps a bare logs or metrics page', () => {
    expect(routeForUrl('https://s.example.com/logs')).toBe('/logs');
    expect(routeForUrl('https://s.example.com/metrics-explorer/summary')).toBe('/metrics');
  });

  // Copied from a real SigNoz instance: the query is JSON, URL-encoded twice, with `+` for spaces inside.
  const LOGS_URL =
    'https://ops.creditapp.ca/logs/logs-explorer?compositeQuery=%257B%2522queryType%2522%253A%2522builder%2522%252C%2522builder%2522%253A%257B%2522queryData%2522%253A%255B%257B%2522dataSource%2522%253A%2522logs%2522%252C%2522filter%2522%253A%257B%2522expression%2522%253A%2522%2528resource.k8s.namespace.name%253D%2527main%2527%2BAND%2Bbody%2BCONTAINS%2B%2527Error%2Bprocessing%2Bitem%2527%2BAND%2Bbody.silenceAlerting%2521%253Dtrue%2BAND%2Bbody.todoListName%2521%253D%2527HubspotTodoList%2527%2529%2BAND%2Bservice.name%253D%2527application%2527%2BAND%2BtodoListName%253D%2527ApplicationDocumentConversionTodoList%2527%2522%257D%257D%255D%252C%2522queryFormulas%2522%253A%255B%255D%257D%257D&endTime=1792706700000&startTime=1792706400000';

  it('unpacks a logs explorer link into its filter and fixed time window', () => {
    const route = routeForUrl(LOGS_URL)!;
    const url = new URL(route, 'app://x');
    expect(url.pathname).toBe('/logs');
    expect(url.searchParams.get('q')).toBe(
      "(resource.k8s.namespace.name='main' AND body CONTAINS 'Error processing item' AND body.silenceAlerting!=true AND body.todoListName!='HubspotTodoList') AND service.name='application' AND todoListName='ApplicationDocumentConversionTodoList'",
    );
    expect(url.searchParams.get('from')).toBe('1792706400000');
    expect(url.searchParams.get('to')).toBe('1792706700000');
    expect(url.searchParams.get('last')).toBeNull();
  });

  // The traces link nests a trace operator and two queries; build it the way SigNoz does (encode twice).
  const doubleEncode = (v: unknown) => encodeURIComponent(encodeURIComponent(JSON.stringify(v)));
  const tracesComposite = {
    queryType: 'builder',
    builder: {
      queryData: [
        {
          dataSource: 'traces',
          queryName: 'A',
          filter: { expression: "url.full = 'https://svc.example.com/GraphQL' deployment.environment in ['production']" },
          groupBy: [{ key: 'http.route', dataType: 'string', type: 'attribute' }],
        },
        { dataSource: 'traces', queryName: 'B', filter: { expression: "isRoot = 'true'" }, groupBy: [] },
      ],
      queryTraceOperator: [{ name: 'Trace Operator', expression: 'B -> A', groupBy: [{ key: 'name' }] }],
    },
  };

  it('unpacks a traces explorer link: first query filter, grouping, relative time', () => {
    const link = `https://ops.example.com/traces-explorer?compositeQuery=${doubleEncode(tracesComposite)}&panelTypes=%22table%22&relativeTime=1d`;
    const url = new URL(routeForUrl(link)!, 'app://x');
    expect(url.pathname).toBe('/traces');
    expect(url.searchParams.get('q')).toBe(
      "url.full = 'https://svc.example.com/GraphQL' deployment.environment in ['production']",
    );
    expect(url.searchParams.get('groupBy')).toBe('http.route');
    expect(url.searchParams.get('op')).toBe('1');
    expect(url.searchParams.get('last')).toBe(String(86_400_000));
  });

  it('opens the trace screen for a single trace id link', () => {
    expect(routeForUrl('https://s.example.com/trace/abc123?spanId=x')).toBe('/trace/abc123');
    expect(routeForUrl('https://s.example.com/trace/a%20b')).toBe('/trace/a%20b');
  });

  it('still opens the page when an explorer link has no usable query', () => {
    expect(routeForUrl('https://s.example.com/traces-explorer')).toBe('/traces');
    expect(routeForUrl('https://s.example.com/logs/logs-explorer?compositeQuery=garbage')).toBe('/logs');
  });

  it('returns null for things it does not know', () => {
    expect(routeForUrl('https://example.com/pricing')).toBeNull();
    expect(routeForUrl('not a url')).toBeNull();
    expect(routeForUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('firstUrl', () => {
  it('pulls a URL out of shared text', () => {
    expect(firstUrl('Alert firing! https://s.example.com/alerts/overview?ruleId=1 (see)')).toBe(
      'https://s.example.com/alerts/overview?ruleId=1',
    );
    expect(firstUrl('nothing here')).toBeNull();
  });
});

describe('explorerQuery', () => {
  const q = (composite: unknown) => new URLSearchParams({ compositeQuery: JSON.stringify(composite) });

  it('reads a plain once-encoded query', () => {
    const out = explorerQuery(q({ builder: { queryData: [{ dataSource: 'logs', filter: { expression: "a = 'b'" } }] } }));
    expect(out).toMatchObject({ signal: 'logs', expression: "a = 'b'", hasTraceOperator: false });
  });

  it('skips disabled queries', () => {
    const out = explorerQuery(
      q({ builder: { queryData: [{ disabled: true, filter: { expression: 'x' } }, { filter: { expression: 'y' } }] } }),
    );
    expect(out?.expression).toBe('y');
  });

  it('converts the older filters.items format', () => {
    const out = explorerQuery(
      q({
        builder: {
          queryData: [
            {
              dataSource: 'logs',
              filters: {
                op: 'AND',
                items: [
                  { key: { key: 'service.name' }, op: '=', value: "it's" },
                  { key: { key: 'severity_text' }, op: 'in', value: ['ERROR', 'WARN'] },
                  { key: { key: 'trace_id' }, op: 'nexists', value: '' },
                ],
              },
            },
          ],
        },
      }),
    );
    expect(out?.expression).toBe("service.name = 'it\\'s' AND severity_text IN ['ERROR', 'WARN'] AND trace_id NOT EXISTS");
  });
});

describe('relativeTimeMs', () => {
  it('parses SigNoz durations', () => {
    expect(relativeTimeMs('30m')).toBe(1_800_000);
    expect(relativeTimeMs('"1d"')).toBe(86_400_000);
    expect(relativeTimeMs('2w')).toBe(1_209_600_000);
    expect(relativeTimeMs('soon')).toBeNull();
  });
});
