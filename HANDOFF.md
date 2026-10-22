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
| tsc, `expo lint`, 55 unit tests | Pass (last run on the Windows box) |
| `expo export` Metro bundle | Passed earlier in the project, not re-run after the latest changes |
| Android debug build | **Never completed.** First blocked by the Windows 260-char path limit (react-native-reanimated CMake). Long paths were then enabled and prebuild succeeds, but the emulator would not start from `expo run:android`, so the Gradle build was never reached |
| Running on any device or simulator | **Never done.** No screen has been seen running |
| iOS | Never built (needs a Mac, which is the point of this handoff) |
| Against a real SigNoz | **Never done.** Only the mock server, which is shaped from the SigNoz OpenAPI spec |
| Release build / R8 / `eas update` / `eas build --local` | Not run |

Treat every screen as untested UI. Expect layout and runtime bugs on first launch.

## First steps on the Mac

1. `npm install`, then `npx expo-doctor`, `npx tsc --noEmit`, `npx expo lint`, `npm test`.
2. `node tools/mock-signoz/server.mjs 3301`, then `npx expo run:ios`. Connect to `http://localhost:3301`, key `test-key`.
3. Walk every tab and each detail screen. Fix what is broken before adding features.
4. Stand up a real SigNoz (see below) and connect to it. This is where API-shape mistakes will show up.

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
- `LICENSE` is the create-expo-app template's MIT notice (Expo/650 Industries). Choose the project's own license before
  treating this as open source in any real sense.
- `npm audit` reports 20 high-severity advisories that were never reviewed.

## Known gaps and good next work

Roughly in priority order, tied to the owner's goal:

1. **Make the existing screens actually work on a device** (see First steps).
2. **Attribute-driven filtering.** On a log or span detail screen, every attribute/resource row should offer "add to
   filter" (and "exclude"), writing into the same filter expression the Logs and Traces screens use. Show active filters
   as removable chips instead of one raw text box, with a raw-expression editor as the escape hatch. Autocomplete keys
   and values from SigNoz's field-key/value endpoints.
3. **Span and trace drill-down.** There is no trace detail yet: build a waterfall (parent/child spans, durations, errors),
   a span detail sheet with attributes, and jump between a span and its logs via `trace_id`. Today the Traces screen is a
   flat list with grouped counts.
4. **Logs ergonomics.** Tap an attribute in a log to filter; severity and service quick filters; live tail option; copy a
   log or a deep link to it.
5. **Traces explorer features**: ordering and column choice, aggregation choice (count, p99, error rate) for the grouped
   view, trace operator support if the API allows.
6. **Metrics**: label group-by, aggregation picker, better metric search.
7. **Alerts**: the rule detail only shows the timeline; consider the underlying query and a link to related logs/traces.
8. Remembered links: a link tapped while signed out is lost. Dashboards are not covered at all.
9. Then iOS and Android release builds, `eas update` to a channel, and store-listing checks.

## Environment gotchas learned

- Windows only: the 260-char path limit breaks the reanimated native build. Enable `LongPathsEnabled`, or build from a short
  path. `subst` does not help because Node resolves the real path. Not an issue on macOS.
- Android emulator on the Windows box would only boot **headless**: `emulator -avd <name> -no-window -no-audio -gpu
  swiftshader_indirect`. Letting `expo run:android` start it timed out.
- The AGENTS.md scaffold text suggests cloud EAS builds; this project overrides that to local-only. Keep it that way.
