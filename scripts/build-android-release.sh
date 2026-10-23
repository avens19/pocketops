#!/usr/bin/env bash
# Builds a signed release locally (no EAS cloud builders).
#
#   scripts/build-android-release.sh [aab|apk] [abis]
#
#   aab   (default) Play Store bundle, all four ABIs (Play splits per device). Output: dist/pocketops-<version>-<code>.aab
#   apk   sideloadable APK; abis default to arm64-v8a,x86_64 (a device and an emulator). Output: dist/pocketops-<version>-<abis>.apk
#
# Signing comes from ~/.pocketops/signing.env (STORE_FILE, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD), never from the repo. Create the
# keystore once with keytool and keep a backup: an APK signed with a different key cannot update this one, only replace it after an
# uninstall. Needs JDK 17+ and the Android SDK (JAVA_HOME, ANDROID_HOME). Bump expo.android.versionCode for every Play upload.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${POCKETOPS_SIGNING_ENV:-$HOME/.pocketops/signing.env}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (STORE_FILE, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"

KIND="${1:-aab}"
case "$KIND" in
  aab) ABIS="${2:-armeabi-v7a,arm64-v8a,x86,x86_64}"; TASK=bundleRelease ;;
  apk) ABIS="${2:-arm64-v8a,x86_64}"; TASK=assembleRelease ;;
  *) echo "Usage: $0 [aab|apk] [abis]" >&2; exit 1 ;;
esac
VERSION=$(node -p "require('./app.json').expo.version")
CODE=$(node -p "require('./app.json').expo.android.versionCode ?? 1")

[ -d android ] || npx expo prebuild --platform android --no-install
( cd android && ./gradlew "$TASK" \
    -PreactNativeArchitectures="$ABIS" \
    -Pandroid.injected.signing.store.file="$STORE_FILE" \
    -Pandroid.injected.signing.store.password="$STORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$KEY_PASSWORD" )

mkdir -p dist
if [ "$KIND" = aab ]; then
  OUT="dist/pocketops-$VERSION-$CODE.aab"
  cp android/app/build/outputs/bundle/release/app-release.aab "$OUT"
else
  OUT="dist/pocketops-$VERSION-${ABIS//,/+}.apk"
  cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
fi
echo "Built $OUT"
