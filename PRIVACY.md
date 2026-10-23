# PocketOps privacy policy

Last updated: 22 October 2026

PocketOps is a read-only mobile client for [SigNoz](https://signoz.io), written by Andrew Ovens. This policy explains what the app does with your data. The short version: it does not send anything to me.

## What the app stores on your device

- The address of your SigNoz server and the service-account API key you enter. They are kept in the iOS Keychain or the Android Keystore (through the operating system's secure storage) and are removed when you tap Disconnect in Settings or uninstall the app.
- Nothing else is saved. Filters and query results are held in memory only while the app is running.

## What the app sends, and where

- **To your SigNoz server.** The app sends your API key and queries (for alerts, logs, traces, services and metrics) to the server address you entered, and shows what it returns. That server is run by you or your organisation, and its own privacy practices apply. I never receive this traffic, the key, or the data it returns.
- **To Expo, for app updates.** The app checks Expo's update service (`u.expo.dev`) for newer versions of its own code. That request contains the app's version, your operating system, the app's project identifier and a random token that tells the service whether this installation has already asked. It contains none of your SigNoz data. Expo's handling of those requests is described at <https://expo.dev/privacy-explained>.
- **To the app store** that distributed the app, as part of installing and updating it. Apple and Google handle that under their own policies.

## What the app does not do

- It has no advertising, no analytics, no crash reporting and no third-party tracking.
- It does not collect your name, email address, location, contacts, photos or any other personal information.
- It cannot change anything on your SigNoz server. A key with the Viewer role is enough, and I recommend using one.

## Clipboard and local network

- The app reads the clipboard only when you tap "Paste" for the API key or the link box.
- On iOS you may be asked to allow access to your local network. That is only so the app can reach a SigNoz server on your own network.

## Children

The app is a tool for people who operate software systems and is not directed at children.

## Changes and contact

If this policy changes, the new version will be published at this address with a new date. Questions: open an issue at <https://github.com/avens19/pocketops/issues>.
