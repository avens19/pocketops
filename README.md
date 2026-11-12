# PocketOps

A mobile client (iOS + Android) for [SigNoz](https://signoz.io): alerts, logs, services (APM), metrics, and a
"paste a SigNoz link" tab that opens the matching screen. Independent project, not affiliated with SigNoz.

You connect with a server URL and a SigNoz **service-account API key** (Viewer role is enough for browsing; saving views needs saved-view create/update permissions). There is no login flow.
The key is stored in the device keychain/keystore.

Built with Expo SDK 58, Expo Router, and TanStack Query. Builds are local only (`eas build --local`); JS changes ship
with `eas update`.

## Run it

```bash
npm install
npm test                 # unit tests (vitest)
npx tsc --noEmit && npx expo lint

node tools/mock-signoz/server.mjs 3301   # fixture server, key: test-key
npx expo run:ios         # or run:android; needs Xcode / Android Studio
```

In the app, connect to `http://localhost:3301` (iOS simulator) or `http://10.0.2.2:3301` (Android emulator) with the key
`test-key`. The mock is shaped after SigNoz's OpenAPI spec, so it cannot catch a disagreement with a real server.

## Test against a real SigNoz locally

`tools/mock-signoz` is shaped from the OpenAPI spec and has already hidden real-server behaviour (out-of-order time-series
buckets, aggregations returned in arbitrary order). Prefer a real instance for anything that touches the API:

```bash
curl -fsSL https://signoz.io/foundry.sh | bash          # installs foundryctl to ~/.local/bin
mkdir signoz-local && cd signoz-local
printf 'apiVersion: v1alpha1\nkind: Installation\nmetadata:\n  name: signoz\nspec:\n  deployment:\n    flavor: compose\n    mode: docker\n' > casting.yaml
foundryctl cast -f casting.yaml                          # UI on :8080, OTLP on :4317/:4318
# create the admin user at http://localhost:8080, then a Viewer service-account key (Settings → Service Accounts)

node tools/seed-signoz/seed.mjs --hours 6 --live         # five services of traces, logs, metrics; --live keeps emitting
SIGNOZ_ADMIN_PASSWORD=... node tools/seed-signoz/rules.mjs  # alert rules in every state (needs the admin login)
node tools/seed-signoz/metric-names.mjs                      # ~140 differently named metrics, to try the Metrics tab's folders
```

From the Android emulator the host is `http://10.0.2.2:8080`. For the web build (`npx expo start --web`) a browser needs CORS,
which SigNoz does not send: run `node tools/cors-proxy/proxy.mjs 8082` and connect to `http://localhost:8082`. The web build is a
development convenience only (it keeps credentials in localStorage); the app targets iOS and Android.

See [HANDOFF.md](./HANDOFF.md) for status, what is verified, and what to do next. See [AGENTS.md](./AGENTS.md) for
project conventions.

## Saved views

Use **Saved views** in Logs, Traces, or Metrics to load views from SigNoz. **Save view** saves the current log/span query or metric chart, including filters, aggregation, grouping and sort order. Saved log and trace list queries open in their normal explorer tabs, with pagination, detail screens, attribute filtering and trace navigation. Single-query log and trace aggregate tables and charts also open in their normal explorer tabs. Configure aggregation expressions, aliases, grouping, sorting and limits; select a row or series to inspect its matching records, then return to the table or chart. The active view name stays visible; **Update view** saves edits, **Save a copy** creates another view, and **Leave view** keeps the current filters without associating them with the saved view. Metrics and queries the normal explorers cannot represent stay in the full-query preview, where **Edit view** previews local changes. Filters have a text editor; advanced editing supports the full query specification. Time ranges are session controls and are not stored by SigNoz's saved-view API.

Requires `/api/v2/saved_views` (schema `v2`). List, graph, table and value results can be previewed; trace-operator panels require the SigNoz web explorer. All query and display fields are preserved on updates. Viewer keys can load views; use a service-account key with `saved-view:create` and `saved-view:update` to save. The mock server supports in-memory saved views, reset on restart.

Save controls are shown only after `/api/v1/authz/check` confirms create permission or update permission for that particular view. Checks are shared across screens and refreshed after one minute when used again. Unknown permissions (including older servers without the check endpoint) hide writes; local edits and previews remain available. Changing credentials clears cached permission decisions.


### Dashboards

The dashboard icon in each tab's header opens the shared dashboard browser. PocketOps reads `/api/v2/dashboards` (v6 specs), preserves section ordering, and shows collapsible, full-width panels. Dynamic and custom list variables and text variables share a time range across panels; dynamic **All** is sent to SigNoz as `__all__`. Panel-specific time ranges remain honored. Refresh is manual.

Time-series charts, stacked bars, scalar tables, numbers and markdown text are supported for builder queries and composite builder/formula queries. All named results are rendered, with hidden formula inputs preserved in requests and per-column units applied to tables. Expand a panel for values and log/trace drilldown with resolved filters and the exact displayed time window. Formulas and metric series do not imply a span filter, so they have no trace drilldown. Unknown plugins and variable sources show an explicit unsupported state.

Only visible panels load, with at most four panel requests in flight. Collapsing sections, scrolling away or leaving the dashboard cancels unused queries. Cards show four result rows/series; expanded panels show up to 200, and charts draw up to 50 series with truncation stated. This is a viewer: editing dashboards, SQL/PromQL panels, threshold styling and full web chart appearance are not supported yet. The mock server includes the Performance & Scalability fixture with illustrative results.
