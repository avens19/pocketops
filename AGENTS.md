This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

**Builds are always local (`eas build --local`); EAS's cloud builders are not used.** A local build runs on the machine that invokes it, so iOS needs a Mac and Android needs macOS or Linux. `eas update` is not a build and is how JS changes ship: channels `development`, `preview`, `simulator` and `production` (see `eas.json`), with `runtimeVersion.policy: appVersion`, so bump `expo.version` in `app.json` whenever native code or config changes, and an update only reaches builds of the same version. Config deliberately mirrors the AgCadence app (`agri-crm/apps/mobile`).
Run EAS CLI as `npx eas-cli@latest <command>`.
Docs: https://docs.expo.dev/eas/index.md

## SigNoz API

- Auth is a `SIGNOZ-API-KEY` header carrying a service-account key; a Viewer role is enough and the app is read-only.
- Endpoints and response shapes come from `docs/api/openapi.yml` in the SigNoz repo, not from their docs site, which omits most response models. Those endpoints are marked `alpha`, so expect drift; `src/lib/signoz/api.ts` falls back across rule-list generations (`/api/v3/rules` → `v2` → `v1`).
- `tools/mock-signoz/server.mjs` is a fixture server (key `test-key`, default port 3301; from the Android emulator use `http://10.0.2.2:3301`). It is shaped after the spec, so it cannot catch a disagreement between the spec and a real server.
- Plain `http` is accepted only for private-network hosts (`isPrivateHost` in `src/lib/signoz/client.ts`).

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
