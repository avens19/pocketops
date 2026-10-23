# PocketOps

A read-only mobile client (iOS + Android) for [SigNoz](https://signoz.io): alerts, logs, services (APM), metrics, and a
"paste a SigNoz link" tab that opens the matching screen. Independent project, not affiliated with SigNoz.

You connect with a server URL and a SigNoz **service-account API key** (Viewer role is enough). There is no login flow.
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
```

From the Android emulator the host is `http://10.0.2.2:8080`. For the web build (`npx expo start --web`) a browser needs CORS,
which SigNoz does not send: run `node tools/cors-proxy/proxy.mjs 8082` and connect to `http://localhost:8082`. The web build is a
development convenience only (it keeps credentials in localStorage); the app targets iOS and Android.

See [HANDOFF.md](./HANDOFF.md) for status, what is verified, and what to do next. See [AGENTS.md](./AGENTS.md) for
project conventions.
