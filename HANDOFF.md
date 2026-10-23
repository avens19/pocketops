# PocketOps handoff

Written when moving development from a slow Windows box to a Mac. Read this first, then `AGENTS.md`.

## What it is

Read-only SigNoz client. Endpoint + API key auth, no login. Five tabs: Alerts, Logs, Services, Metrics, Open (a link
modal). Settings is a root screen behind the gear button in each tab header. A root `traces` screen shows spans for a
traces-explorer query.

Goal the owner has stated for the next phase: **easy to use, easy to dive into spans and logs, add filters from
attributes**, and translate SigNoz web UI features to mobile as needed. They are happy to spend a lot of time on this.

## Status, honestly

| Thing | State |
|---|---|
| tsc, `expo lint` (React Compiler rules on), unit tests | Pass (161 tests) |
| Android debug build | Builds and runs (Gradle 9.4, SDK 37, NDK 27) |
| Running on a device | Walked every screen on an API 36 emulator, light and dark, against a local SigNoz v0.146 with seeded data |
| Against a real SigNoz | Local Docker instance only (see README). Not yet against a production-sized instance |
| iOS | Never built (needs a Mac) |
| Release build / R8 | `scripts/build-android-release.sh` builds a signed APK (private keystore in `~/.pocketops`, never in the repo). Installed and walked on the emulator: every screen, plain-http connect, 3,000 random inputs, no crashes |
| `eas update` / `eas build --local` | Not run |

Bugs the first real device run found, all fixed: `/` had no route (cold start landed on "Unmatched Route"; a naive redirect then
looped with the auth guard), the web build's unbound `fetch`, time-series buckets returned out of order, aggregations returned in
arbitrary order (calls/errors/p99 were swapped on the service chart), the connect button hidden behind the keyboard.

## SigNoz API notes

- Auth header `SIGNOZ-API-KEY` (service-account key, Viewer role). `GET /api/v1/service_accounts/me` verifies it; on 404
  the client falls back to listing rules.
- Data comes from `POST /api/v5/query_range` (builder_query; `raw`, `scalar`, `time_series`). Alerts use
  `GET /api/v3/rules` with fallback to v2 then v1, `GET /api/v1/alerts`, and `GET /api/v2/rules/{id}/history/timeline`.
- Shapes come from `docs/api/openapi.yml` in the SigNoz repo, not the docs site. Those endpoints are marked alpha.
- SigNoz web URL shapes that `src/lib/deeplink.ts` maps were written from memory plus two real examples the owner
  pasted (a logs explorer link and a traces explorer link, both with `compositeQuery` JSON URL-encoded twice). The logs
  example is a test fixture. Other shapes (dashboards, metrics explorer, exceptions, `/trace/<id>`) are unverified.
- The SigNoz repo no longer ships docker-compose manifests. `install.sh` and `deploy/` are deprecated in favour of
  **Foundry**: <https://signoz.io/docs/install/docker/> (`curl -fsSL https://signoz.io/foundry.sh | bash`, then
  `foundryctl forge` / `foundryctl cast` from a `casting.yaml`). A small local instance plus `telemetrygen` (OpenTelemetry
  contrib) is the plan for generating test data. Docker Desktop was installed on the Windows box but the machine was too
  slow to make this practical.

## Architecture in one pass

- `src/lib/signoz/client.ts`: `SignozClient`, `SignozError(kind)`, `normalizeEndpoint`, `isPrivateHost` (plain `http` only
  for private hosts).
- `src/lib/signoz/queries.ts`: v5 query builders and response parsers, `RangeSpec` (preset, relative, or fixed window).
- `src/lib/signoz/api.ts`: typed fetchers (alerts, logs, services, spans, metrics).
- `src/lib/deeplink.ts`: `routeForUrl` turns SigNoz URLs and `pocketops://` links into routes, unpacking explorer
  `compositeQuery`. Route params for logs/traces: `q` (filter expression), `groupBy`, `last` (ms), `from`/`to` (epoch ms),
  `op` (link used a trace operator, which the app cannot run).
- `src/app`: Expo Router. `(tabs)/*` each a Stack via `components/tab-stack.tsx`. Root `_layout.tsx` has the auth guard
  (`Stack.Protected`) plus `open-link` (modal), `settings`, `traces`.
- The Open tab (`(tabs)/link`) presents the `open-link` modal on focus; `lib/link-modal.ts` stops it reopening when the
  modal closes.
- `tools/mock-signoz/server.mjs`: zero-dependency fixture server.
- `scripts/make-icons.mjs`: regenerates icon/splash assets (sharp). Logo is "pocket + pulse", accent `#E8590C`.

## Decisions and constraints

- **Name PocketOps** was chosen after a web-search-only trademark check ("Lookout" was rejected for a conflict). That is
  not legal advice and USPTO/CIPO/app-store searches were never run. Do those before publishing to a store.
- **No push notifications.** They would need a webhook relay from SigNoz to APNs/FCM. Not built.
- **Links do not open the app by tapping.** Claiming a self-hosted domain via Universal/App Links was tried and
  deliberately removed at the owner's request. The supported route is the Open tab: paste a link.
- Keep the app read-only. A Viewer-role key is enough.
- `app.json` carries the EAS project id (`8545604c-4e75-41bb-8ec3-d2b4ef53a89e`) and owner `avens19s-team`. An older, empty
  EAS project named `lookout` still exists in the Expo dashboard and should be deleted there (not possible via CLI).
- `eas.json` mirrors the owner's other app (AgCadence): channels per profile, `runtimeVersion.policy: appVersion`, local
  builds only, no cloud builders. Bump `expo.version` whenever native code or config changes.
- `LICENSE` is MIT, copyright Andrew Ovens (the Expo template notice was replaced).
- `npm audit` reports 20 high-severity advisories. Triaged: they reduce to two root causes, `braces` (a denial of service on deeply
  nested glob patterns) and `node-forge` (an RSA signature-verification flaw, used by expo-updates' CLI code signing). Both are build/CLI
  tooling: neither, nor `metro`/`micromatch`, appears in the app's JS bundle (checked against the exported source map). The
  "fixes" npm suggests are downgrades to expo 44 / react-native 0.72, so do not run `npm audit fix --force`. Revisit when Expo
  ships updated tooling.

## What exists now (beyond the first handoff)

- **Filtering**: `lib/filters.ts` parses and writes SigNoz filter expressions as chips (AND-joined clauses; anything else is kept
  verbatim as a raw clause). `lib/explorer-state.ts` holds one filter per explorer (logs, traces) outside the screens, so a detail
  screen can add a filter and the list it returns to already shows it. Route params (links, "view logs for this alert") are applied
  once per navigation through `lib/explore-links.ts`. `FilterBar` / `FilterEditor` autocomplete keys and values from
  `/api/v1/fields/keys|values`.
- **Attributes everywhere are tappable** (`AttributeList`): show only / hide / the other signal / copy.
- **Traces tab** (replaced the Open tab; Open link is a header button): root spans by default, Errors / Slowest toggles, paging.
- **Trace screen** (`app/trace/[id].tsx`): waterfall from `POST /api/v4/traces/{id}/waterfall` (falls back to a span query),
  collapsible subtrees, "Jump to failure", inline span detail with exception events.
- **Alerts**: firing instances link to the logs/traces behind them, filtered by the rule's query plus the instance's labels.
- **Charts**: axis, gridlines, time labels, touch-scrub readout.
- **Group by** on Traces: spans, errors and p99 per value of a field; tap a row to drill into those spans.
- **Live tail** on Logs (its own stable-key query of the newest 200 logs, refetched every 3s only while the screen is focused, the app is in the foreground and the list is scrolled to the top; verified against a 5s-latency server and in a release build) and **Copy as JSON** on a log.
- **Connection banner** (`lib/connection*.ts`, `ConnectionBanner`): screens keep their last data when a refresh fails, which looks
  healthy; a global banner says when requests are failing (unreachable / server error / key rejected) and how old the data is.

## Known gaps and good next work

1. iOS build and a pass on a real device (Android emulator is not a phone: gestures, fonts, notch).
2. Test against a production-sized SigNoz (34+ services, millions of spans): paging, autocomplete latency, waterfall size.
3. A deep link to a log; group-by across more than one field in the UI (links already carry several).
4. Metrics: label filters and better search (aggregation choices, real label splits and unit formatting exist).
5. Dashboards are not covered at all. A link tapped while signed out is lost.
6. Trace operators (`B → A`) cannot run.
7. Then release builds, `eas update` to a channel, and store-listing checks.

## Structured log bodies (found on a real instance)

A log's `body` is not always text: structured loggers arrive as a JSON **object**, with the readable text in `message`
(`lib/log-body.ts`). Showing `String(body)` printed "[object Object]". Now: list rows lead with the message and show a few fields
(`method=GET path=/health status=200`) on a quieter line; the detail screen shows the message, the whole body as JSON, and every field
as a tappable row filtering on `body.<key>` (verified on a real instance: `body.method = 'GET'`, `body.status = 200` both work). JSON
that arrives as *text* is shown the same way but its fields are read-only, because the server cannot filter inside a string. Note
`body CONTAINS 'x'` (the Logs search box) only searches `body.message` on such instances.

## Release-only bugs worth remembering

- `AppState.currentState` can still be `unknown` when the first screen of a release build renders, and no change event follows, so a
  hook that started from `currentState === 'active'` never polled. Only an explicit `background` / `inactive` stops polling
  (`lib/app-state.ts`).
- `maintainVisibleContentPosition` on the live list left it scrolled to the bottom of 200 rows. Live now pauses while the list is
  scrolled away from the top instead.
- The seeder used to stamp data up to a minute into the future, which makes any "now"-bounded live view look laggy.

## Environment gotchas learned

- Windows only: the 260-char path limit breaks the reanimated native build. Enable `LongPathsEnabled`, or build from a short
  path. `subst` does not help because Node resolves the real path. Not an issue on macOS.
- Android emulator headless: `emulator -avd <name> -no-window -no-audio -gpu swiftshader_indirect`. It needs KVM on Linux
  (`/dev/kvm` and your user in the `kvm` group). Drive it with `adb`: `uiautomator dump` lists on-screen text and accessibility
  labels, which is far more reliable than tapping coordinates. Give interactive controls an `accessibilityLabel`.
- The AGENTS.md scaffold text suggests cloud EAS builds; this project overrides that to local-only. Keep it that way.
