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

See [HANDOFF.md](./HANDOFF.md) for status, what is verified, and what to do next. See [AGENTS.md](./AGENTS.md) for
project conventions.
