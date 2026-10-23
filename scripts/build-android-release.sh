#!/usr/bin/env bash
# Builds a signed release APK locally (no EAS cloud builders).
#
#   scripts/build-android-release.sh [abis]        abis default: arm64-v8a,x86_64
#
# Signing comes from ~/.pocketops/signing.env (STORE_FILE, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD), never from the repo. Create the
# keystore once with keytool and keep a backup: an APK signed with a different key cannot update this one, only replace it after an
# uninstall. Needs JDK 17+ and the Android SDK (JAVA_HOME, ANDROID_HOME). Output: dist/pocketops-<version>.apk
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${POCKETOPS_SIGNING_ENV:-$HOME/.pocketops/signing.env}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (STORE_FILE, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"

ABIS="${1:-arm64-v8a,x86_64}"
VERSION=$(node -p "require('./app.json').expo.version")

[ -d android ] || npx expo prebuild --platform android --no-install
( cd android && ./gradlew assembleRelease \
    -PreactNativeArchitectures="$ABIS" \
    -Pandroid.injected.signing.store.file="$STORE_FILE" \
    -Pandroid.injected.signing.store.password="$STORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$KEY_PASSWORD" )

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "dist/pocketops-$VERSION.apk"
echo "Built dist/pocketops-$VERSION.apk"
