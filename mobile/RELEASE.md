# Holler app: release runbook (owner's Mac)

From a fresh clone to a TestFlight upload and a signed Android App Bundle (AAB). Every command block is safe to paste into zsh as is: no inline comments, every path quoted. Run the blocks in order. Where a block says "you type", the terminal waits for you and nothing is stored in a file.

Before any of this, finish `STORE-SETUP.md` steps 1 to 4 at least once (Apple, Supabase, RevenueCat). You can build and run the app without them, but sign-in and purchases will not work.

## What is already done in the repo

- `mobile/` is its own package: Vite, React, TypeScript, Capacitor 8.6.2. The website build never reads it.
- `mobile/ios` was generated with `npx cap add ios --packagemanager SPM` and `mobile/android` with `npx cap add android`. **Never run `npx cap add` again.** It rewrites the native projects and wipes the settings below. From now on only `npx cap sync`.
- iOS: bundle id `com.localholler.app`, iPhone only, portrait, iOS 15.0 minimum, team `B3B65JKTQ7`, `App.entitlements` (Push Notifications, Sign in with Apple), `PrivacyInfo.xcprivacy`, `ITSAppUsesNonExemptEncryption = NO`, URL scheme `holler`, the three push hooks in `AppDelegate.swift`.
- Android: application id `com.localholler.app`, minSdk 24, compile and target SDK 36, portrait, `INTERNET` and `POST_NOTIFICATIONS`, the `holler://auth-callback` intent filter, the push channel icon, release signing that reads `HOLLER_UPLOAD_*` and stops the build when they are missing.
- Icons and splash screens are generated from the website's own mark (`npm run cap:assets` rebuilds them).

## 0. One-time tools on the Mac

You need Xcode (with command line tools), Android Studio (with SDK Platform 36), Node 22 and git. Check them:

```zsh
xcodebuild -version
node -v
npm -v
git --version
ls "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java"
ls "$HOME/Library/Android/sdk/platforms"
```

`node -v` must print `v22.x`. The last line must list `android-36`. If it does not, open Android Studio, Settings, Languages & Frameworks, Android SDK, tick Android 16 (API 36), Apply.

## 1. Clone and set the repo path

Pick where the repo lives. Change only the path inside the quotes if you keep it somewhere else. In the clone line, replace OWNER with the GitHub account that holds the repo.

```zsh
export HOLLER_REPO="$HOME/Projects/holler"
git clone "https://github.com/OWNER/holler.git" "$HOLLER_REPO"
cd "$HOLLER_REPO/mobile"
npm ci
```

If you already have the repo, skip the clone and run `git pull` instead. Every later block starts with `cd "$HOLLER_REPO/mobile"`, so set `HOLLER_REPO` again in each new terminal window.

## 2. The public build settings (once)

The app reads public settings from `mobile/.env.production.local`. That file is ignored by git. Create it from the example and open it:

```zsh
cd "$HOLLER_REPO/mobile"
cp .env.example .env.production.local
open -e .env.production.local
```

Fill in (STORE-SETUP.md says where each value comes from):

| Name | Value |
|---|---|
| `VITE_API_BASE` | `https://localholler.com` |
| `VITE_SUPABASE_URL` | the project URL, `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon (publishable) key. Never the service role key |
| `VITE_REVENUECAT_IOS_KEY` | RevenueCat public App Store key, starts with `appl_` |
| `VITE_REVENUECAT_ANDROID_KEY` | RevenueCat public Play key, starts with `goog_` |
| `VITE_APPLE_SIGN_IN` | `true` once STORE-SETUP step 3 is done |
| `VITE_GOOGLE_SIGN_IN` | read STORE-SETUP step 3c first; `false` is the safe default |
| `VITE_PUSH_ENABLED` | `true` only after step F below |
| `VITE_IOS_EXTERNAL_PURCHASE_LINK` | leave `false` (owner decision: the US web purchase link stays off until the owner turns it on) |

`npm run build` refuses to build when a value here looks like a secret (an `sk_` key, a service role JWT, a private key). That is on purpose: everything in this file ends up inside the app.

## 3. Build the web layer and sync it into both native projects

Run this every time before you open Xcode or Android Studio, and after every `git pull`:

```zsh
cd "$HOLLER_REPO/mobile"
npm ci
npm test
npm run build
npx cap sync
```

`npm run build` runs, in order: the secret check, the version parity check, the TypeScript check, the Vite build. `npx cap sync` copies `dist/` into both apps and writes the iOS Swift package list. It also creates `ios/App/CapApp-SPM/symlinks/`, which git ignores because it holds a path to this Mac's `node_modules`. Xcode cannot resolve packages until the sync has run once on this Mac.

## Version parity (every release)

One version number everywhere: `package.json` `version` = iOS `MARKETING_VERSION` = Android `versionName`. The build number goes up by one on every upload: iOS `CURRENT_PROJECT_VERSION` and Android `versionCode`, even for the same version.

Check it:

```zsh
cd "$HOLLER_REPO/mobile"
npm run check:version
```

It prints for example `version 1.0.0 | iOS 1.0.0 (build 1) | Android 1.0.0 (versionCode 1)` and fails on a mismatch. To bump, edit `package.json` `version`, then in Xcode (target App, General) Version and Build, then in `android/app/build.gradle` `versionName` and `versionCode`. Run the check again.

## iOS: to TestFlight

### I1. Open the project

```zsh
cd "$HOLLER_REPO/mobile"
npx cap open ios
```

Xcode opens `ios/App/App.xcodeproj`. Wait for "Resolving Package Graph" to finish (the first time it downloads Capacitor, Firebase and RevenueCat; several minutes). If it fails with a missing `symlinks/CapacitorFirebaseMessaging`, close Xcode, run step 3 again, reopen.

### I2. Signing and capabilities (first time only)

Select the **App** project, then the **App** target, then **Signing & Capabilities**:

1. **Automatically manage signing**: ticked. **Team**: ColorLabPro, Inc. (B3B65JKTQ7). Bundle Identifier: `com.localholler.app`.
2. The capability list must show **Push Notifications** and **Sign in with Apple**. They come from `App/App.entitlements`. If one is missing, click **+ Capability** and add it; Xcode writes it into the same file.
3. Do NOT add Background Modes, App Groups, Associated Domains or any other capability.
4. **General** tab: Supported Destinations shows **iPhone** only. Minimum Deployments **iOS 15.0**. Device Orientation: **Portrait** only.

### I3. Push (step F) for iOS

Once you have `GoogleService-Info.plist` from Firebase (STORE-SETUP step 5):

1. Drag the file from Finder onto the **App** folder (yellow, under the App project) in Xcode's left panel.
2. In the sheet: tick **Copy items if needed**, tick target **App**, click **Finish**.
3. The file is now `ios/App/App/GoogleService-Info.plist`. It holds no secret; commit it with the project change.

Without this file the app builds and runs with push off. With it, set `VITE_PUSH_ENABLED=true` in `.env.production.local` and run step 3 again.

### I4. Archive and upload

1. Bump the build number if this version was uploaded before (Version parity above).
2. Top bar destination: **Any iOS Device (arm64)**.
3. **Product > Archive**. If it fails, read the FIRST error in the issue list.
4. The Organizer opens. Select the new archive, **Distribute App**, **App Store Connect**, **Upload**, keep the defaults (automatic signing, upload symbols), **Upload**.
5. In App Store Connect, the build shows under TestFlight after processing (often 10 to 30 minutes). Answer the export compliance question if asked: the app uses no non-exempt encryption (the plist already says so, so usually nothing is asked).

## Android: to a signed AAB

### A1. The upload keystore (once, ever)

Google Play signs the app for users; this key only proves uploads come from you. Losing it means a key reset request to Google, so back up `~/keys` (for example to an encrypted drive). The command asks for a password twice and some name fields: **you type** them. Use the same password for the store and the key.

```zsh
mkdir -p "$HOME/keys"
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -genkeypair -v -storetype PKCS12 -keystore "$HOME/keys/holler-upload.jks" -alias holler-upload -keyalg RSA -keysize 2048 -validity 10950
ls -la "$HOME/keys/holler-upload.jks"
```

### A2. Find your home path

```zsh
echo "$HOME/keys/holler-upload.jks"
```

### A3. Tell Gradle where the key is

Open your personal Gradle settings (outside the repo, never committed):

```zsh
mkdir -p "$HOME/.gradle"
touch "$HOME/.gradle/gradle.properties"
open -e "$HOME/.gradle/gradle.properties"
```

Add these four lines. Replace the whole first value with the path printed in A2, and **type** the password from A1 after the `=` on the two password lines:

```
HOLLER_UPLOAD_STORE_FILE=/Users/<you>/keys/holler-upload.jks
HOLLER_UPLOAD_STORE_PASSWORD=
HOLLER_UPLOAD_KEY_ALIAS=holler-upload
HOLLER_UPLOAD_KEY_PASSWORD=
```

Save and close. Then lock the file to your user:

```zsh
chmod 600 "$HOME/.gradle/gradle.properties"
```

If any of the four is missing, or the keystore file is not at that path, every release build stops with "Holler release signing is not set up" and names the missing property (never its value). Debug builds do not need them.

### A4. Push (step F) for Android

Put `google-services.json` from Firebase (STORE-SETUP step 5) at `android/app/google-services.json`:

```zsh
cp "$HOME/Downloads/google-services.json" "$HOLLER_REPO/mobile/android/app/google-services.json"
ls -la "$HOLLER_REPO/mobile/android/app/google-services.json"
```

The Gradle build applies the Google services plugin only when this file exists, so without it the app builds and runs with push off. It holds no secret; commit it.

### A5. Build the AAB

```zsh
cd "$HOLLER_REPO/mobile"
npm run build
npx cap sync android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd "$HOLLER_REPO/mobile/android"
./gradlew clean bundleRelease
ls -la "$HOLLER_REPO/mobile/android/app/build/outputs/bundle/release/"
```

The last line must show `app-release.aab`. Check it is signed with your upload key:

```zsh
"$JAVA_HOME/bin/jarsigner" -verify -verbose -certs "$HOLLER_REPO/mobile/android/app/build/outputs/bundle/release/app-release.aab" | tail -5
```

It must end with `jar verified.` Upload `app-release.aab` in Play Console, Testing, Internal testing, Create new release.

To run on a phone instead: `npx cap open android`, pick the device, Run. A debug build needs no keystore.

## Device smoke test (every build, on a real iPhone and a real Android phone)

Install from TestFlight and from the Play internal track. Use a fresh test account unless a line says otherwise.

1. First launch: the splash is the orange mark on off-white; the welcome screen shows; no system prompt appears.
2. With Apple on: **Sign in with Apple** sits above **Continue with Google**. With `VITE_APPLE_SIGN_IN=false`: neither social button shows.
3. **Sign up with email**: account is created, you land on "Set up your alerts", and a "confirm your email" message arrives from Holler (not from Supabase).
4. Sign in with Apple on iPhone: Apple's sheet, then onboarding (new) or the feed (existing). Cancel on the sheet shows no error.
5. Continue with Google (if on): an in-app browser opens, comes back to the app on its own, you are signed in.
6. Onboarding: trade chips stop at the plan limit, a bad ZIP shows an error under the field, the radius slider moves in steps of 5.
7. After onboarding: the "Hear about new work first" screen. **Turn on alerts** shows the system prompt. Allow. (Without the Firebase files the app says notifications aren't available and goes on.)
8. Feed: cards show the intent label, title, place, day, distance and source. Pull down at the top refreshes. Scroll to the end loads more. **Useful**, **Not relevant**, **Led to work** each save; **Led to work** offers the job amount.
9. Tap a card: the detail shows the summary, **Open the source record** opens the record in the in-app browser, and "Who to contact" shows when the record has one.
10. Push: from the server, trigger a notify run for this account (or wait for a real match). The notification arrives with the app closed. Tapping it opens that alert (one alert) or the feed (several). Repeat with the app in the background and with it fully closed.
11. Area check: works signed out from the welcome screen and signed in from the tab bar.
12. Paywall: Settings, See plans. Prices come from the store (Sandbox prices on TestFlight). The trial line appears only for an Apple ID or Google account that has never used the trial. Restore purchases is always there. Terms and Privacy open.
13. Buy Solo monthly with a Sandbox or license-tester account: the sheet closes, the feed shows the plan right away, and within a minute Settings shows "Solo plan" from the server too.
14. Restore purchases on a second device with the same store account: the plan comes back.
15. A member who pays on the website: the paywall says the plan is billed through the website and shows no buy buttons.
16. Settings: push switch on and off, email digest switch, Manage subscription opens the store page, Terms, Privacy, Support open.
17. Sign out: back to welcome. Sign in again as someone else: no data from the first account shows, and the store sees the new user.
18. Delete account: the button stays disabled until DELETE is typed; after delete you are signed out. With a store plan active, the app tells you to cancel it in the store and offers the link.
19. Android only: the back button goes back a screen and leaves the app from Alerts. Rotate the phone: the app stays portrait.
20. Turn on Airplane mode and open each tab: every screen shows a plain error with Try again, never a blank screen.
