# PocketOps store submission

Everything the two consoles ask for, in the order they ask for it. Listing text is in `store/metadata/` (fastlane layout, so
`fastlane deliver` / `fastlane supply` can push it later); screenshots are in `store/screenshots/`; the pages the listings link
to are in `store/site/` and are served from `https://pocketops.andrewovens.com`.

Version `1.0.0`, iOS build number `1`, Android `versionCode` `1` (bump `expo.android.versionCode` and `expo.ios.buildNumber` in
`app.json` for every upload).

## Status (22 Oct 2026)

| | Android | iOS |
|---|---|---|
| Release artifact | Done: `dist/pocketops-1.0.0-1.aab`, signed with the upload key, installed from the bundle on an API 36 emulator | **Not built**: Xcode on this Mac has no Apple account signed in, and the App Store Connect API key cannot register the bundle ID or create signing assets |
| Listing text, graphics, screenshots | Done | Done |
| Privacy policy, support page | Live | Live |
| App record in the console | **Not created**: the Play API reports "Package not found" | **Not created**: App Store Connect has no app for `com.andrewovens.pocketops` |

What needs you: create both app records by hand, and sign in to Xcode (Settings, Accounts) so the archive command below can create the
distribution certificate, App ID and profile.

## Identity

| | |
|---|---|
| Name | PocketOps (Play: PocketOps for SigNoz) |
| Bundle ID / package | `com.andrewovens.pocketops` |
| Apple team | `YZGA278893` (Andrew Ovens, Individual) |
| Price | Free |
| Privacy policy | https://pocketops.andrewovens.com/privacy |
| Support | https://pocketops.andrewovens.com/support |
| Marketing | https://pocketops.andrewovens.com/ |
| Review login | Server `https://pocketops.andrewovens.com`, key in `store/metadata/ios/review_information/` (gitignored) |

## Google Play

Artifact: `dist/pocketops-1.0.0-1.aab` (`scripts/build-android-release.sh aab`), signed with the upload key in
`~/.pocketops/release.keystore`. **Back that keystore up**: Play App Signing holds the app-signing key, but you can only reset a lost
upload key through support.

Play rejects API uploads until the first bundle has been uploaded by hand, so the first upload goes through the console.

1. Create app: name `PocketOps for SigNoz`, English (US), App, Free.
2. Store listing: `store/metadata/android/en-US/` (title, short and full description). Graphics: `store/screenshots/android/`
   (icon 512, feature graphic 1024x500, phone screenshots).
3. App category: Tools. Contact email: yours. Website: https://pocketops.andrewovens.com/. Privacy policy URL as above.
4. **App access**: "All or some functionality is restricted". Instructions: the demo server URL and key from the review notes.
5. **Ads**: no ads.
6. **Content rating** (IARC questionnaire, category "Utility, Productivity, Communication, or Other"): answer No to every
   violence, sexual content, language, controlled substance, gambling and user-interaction question. The app has no user-generated
   content shared between users, no location sharing, no purchases. Expect Everyone / PEGI 3.
7. **Target audience**: 18 and over. Not designed for children.
8. **Data safety**:
   - Does the app collect or share any of the required user data types? **No.** Everything the app handles is sent only to a server the
     user enters; none of it reaches the developer. (EAS Update contacts Expo with the app version, OS and a random install token for
     app updates; Expo's own statement says this carries no unique device identifier. If you would rather over-declare, add
     "Device or other IDs: collected, app functionality, not shared".)
   - Is all data encrypted in transit? **Yes** (HTTPS to the user's server; plain HTTP is allowed only for private-network addresses).
   - Can users request deletion? Not applicable (nothing is collected); Disconnect in Settings clears what is stored on the device.
9. Government apps: No. Financial features: None. Health: None. News: No.
10. Release: Production (or an internal/closed track first). Release notes: `store/metadata/android/en-US/changelogs/1.txt`.

A personal Play developer account created after Nov 2023 must run a closed test with at least 12 testers for 14 days before it can
publish to production. Check the account type in the console before planning the launch date.

## Apple App Store

Artifact: an App Store archive of `ios/` (see "Build" below). **Not done yet: signing needs Xcode signed in to your Apple ID.**

1. App Store Connect, Apps, New App: iOS, name `PocketOps`, English (US), bundle ID `com.andrewovens.pocketops`, SKU `pocketops-ios`.
   The API cannot create the record, so this one is by hand. The bundle ID must exist first (Certificates, Identifiers & Profiles),
   or Xcode creates it the first time it signs with a signed-in account.
2. App Information: subtitle, category Developer Tools (secondary Productivity), content rights: no third-party content.
3. Pricing: Free, all territories.
4. App Privacy: **Data Not Collected.** Privacy policy URL as above. (Same Expo caveat as the Play data safety note.)
5. Age rating questionnaire: None for every item. Result: 4+.
6. Version 1.0 page: promotional text, description, keywords, support and marketing URL, copyright, what's new, from
   `store/metadata/ios/`. Screenshots: `store/screenshots/ios-6.9in/` (1320x2868, accepted for all iPhone sizes). The app is
   iPhone only (`supportsTablet: false`), so no iPad screenshots.
7. App Review Information: sign-in required is **No** (there is no account; the key goes in the notes). Notes and demo values:
   `store/metadata/ios/review_information/notes.txt`. Add your name, phone and email.
8. Export compliance: already answered in the build (`ITSAppUsesNonExemptEncryption = false`; the app only uses the OS's HTTPS).
9. Content rights, advertising identifier: No IDFA.

### Build and upload

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
npx expo prebuild --platform ios --clean
xcodebuild -workspace ios/PocketOps.xcworkspace -scheme PocketOps -configuration Release \
  -destination 'generic/platform=iOS' -archivePath dist/PocketOps.xcarchive \
  DEVELOPMENT_TEAM=YZGA278893 -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath dist/PocketOps.xcarchive -exportPath dist/ipa \
  -exportOptionsPlist store/ExportOptions.plist -allowProvisioningUpdates
xcrun altool --upload-app -f dist/ipa/PocketOps.ipa -t ios --apiKey <key id> --apiIssuer <issuer id>
```

## Before you publish

- **Add the store links to the landing page** (`store/site/index.html`) once both listings are live, then redeploy:
  `rsync -a --delete store/site/ 192.168.219.100:www/pocketops/` (no Caddy reload needed for content).
- **Trademark check.** The name was chosen after a web search only (see HANDOFF.md). Run USPTO, CIPO and app store searches.
- **Naming SigNoz.** The subtitle, Play title and descriptions say "SigNoz" to say what the app connects to, with a
  not-affiliated line in the description. Both stores can object to third-party names in metadata; if one does, drop "for SigNoz"
  from the Play title and the subtitle.
- **Screenshots show mock data.** They were taken against the demo server, which serves fixtures (four alerts, five services). Retake
  against a real SigNoz if you want richer shots.
