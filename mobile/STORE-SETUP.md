# Holler app: store and service setup

Every value to enter, in order. Do the steps top to bottom: later steps need values from earlier ones. Fixed identifiers (they cannot be renamed once created):

| What | Value |
|---|---|
| Bundle id / application id | `com.localholler.app` |
| App name | Holler |
| URL scheme and sign-in callback | `holler` / `holler://auth-callback` |
| Products | `com.localholler.app.solo.monthly`, `com.localholler.app.solo.yearly`, `com.localholler.app.pro.monthly`, `com.localholler.app.pro.yearly` |
| Entitlements | `solo`, `pro` |
| Offering | `default` |
| Android push channel | `alerts` |
| Apple team | ColorLabPro, Inc. (B3B65JKTQ7) |

Prices (decided for this round): Solo $7.99 a month or $79.99 a year. Pro $13.99 a month or $139.99 a year. The app never prints a price of its own: it shows what the store returns.

## 1. Apple Developer (developer.apple.com, Certificates, Identifiers & Profiles)

1. **Identifiers, +, App IDs, App**. Description `Holler`, Bundle ID **Explicit** `com.localholler.app`. Capabilities: tick **Push Notifications** and **Sign in with Apple** (Enable as a primary App ID). Nothing else. Register.
2. **Keys, +**. Name `Holler APNs`, tick **Apple Push Notifications service (APNs)**, Continue, Register, **Download** the `.p8` (one download only). Note the **Key ID**. This goes to Firebase in step 5. If an APNs key already exists for the team, you may reuse it instead: APNs keys work for every app of the team.
3. **Sign in with Apple for Android and web (only if you will turn on Apple on Android).** Apple on iPhone needs nothing more than step 1. Apple on Android goes through Supabase's web flow, which uses the Services ID and key already configured in the shared Supabase project (see 3c).

## 2. App Store Connect (appstoreconnect.apple.com)

1. **Apps, +, New App**. Platform iOS. Name `Holler` (if taken, `Holler: Local Job Alerts`). Primary language English (U.S.). Bundle ID `com.localholler.app`. SKU `holler-ios`. User Access: Full Access.
2. **App Information**: Category Business (secondary: Productivity). Content rights: the app shows public records it does not own; answer that it has the rights to use them. Age rating questionnaire: all None, gives 4+.
3. **Pricing and Availability**: Free (the app sells subscriptions). Availability: United States.
4. **Monetization, Subscriptions**: create a subscription group named `Holler`. Add four auto-renewable subscriptions:

   | Reference name | Product ID | Duration | Price (US) | Group level |
   |---|---|---|---|---|
   | Pro Yearly | `com.localholler.app.pro.yearly` | 1 year | $139.99 | 1 |
   | Pro Monthly | `com.localholler.app.pro.monthly` | 1 month | $13.99 | 1 |
   | Solo Yearly | `com.localholler.app.solo.yearly` | 1 year | $79.99 | 2 |
   | Solo Monthly | `com.localholler.app.solo.monthly` | 1 month | $7.99 | 2 |

   Level 1 is the higher service (Pro), so moving Solo to Pro is an upgrade. For each: a display name (`Holler Solo`, `Holler Pro`), a one-line description, and the review screenshot of the paywall. Group localization: display name `Holler`.
5. **Introductory offer (owner decision).** Every new member already gets a 14-day free trial on the server at sign-up, without a card. A store free trial would come on top of it. Two options: (a) no introductory offer (the paywall then shows no trial line; simplest and honest), or (b) a 2-week free trial on each product (the app shows "14-day free trial" only to Apple IDs the store says are eligible). The app handles both. Recommended: (a) for launch.
6. **App Store Server Notifications**: Production and Sandbox URL = the Apple notification URL RevenueCat shows in step 4 (Version 2).
7. **Users and Access, Integrations, In-App Purchase**: generate an **In-App Purchase key**. Download the `.p8`, note the Key ID and the Issuer ID. These go to RevenueCat in step 4.
8. **App Privacy**: Data Not Used to Track You. Data Linked to You: Contact Info (Email Address; Name: the full name Sign in with Apple or Google can return, and the business name, which can be a person's name), Identifiers (User ID, Device ID: the push token), Location (Coarse Location: the ZIP code the member types), Purchases (Purchase History), Financial Info (Other Financial Info: the optional job amount sent with "Led to work" feedback), User Content (Other User Content: keyword watches), Usage Data (Product Interaction: the feedback buttons). Purpose for every type: App Functionality. User ID and Product Interaction also have the purpose Analytics (Holler's own first-party counts, no third-party SDK). No tracking, no third-party advertising. This matches `ios/App/App/PrivacyInfo.xcprivacy`.
9. **App Review Information**:
   - Sign-in required: yes. Make a demo account through the app's email sign-up, finish onboarding (for example Roofing, ZIP 30080, 25 miles) and leave it on the trial. Enter that email and password.
   - Notes (paste): `Holler sends tradespeople alerts about nearby work found in public records (building permits, storm reports, local requests). Native features: push notifications for new alerts (asked only after onboarding, with a plain explanation screen first), Sign in with Apple, in-app subscriptions through StoreKit with Restore Purchases on the paywall and in Settings. Accounts can be deleted in Settings, Delete account (type DELETE). Members who already pay on our website see that plan in the app and are not offered a second purchase.`
10. **TestFlight**: add yourself as an internal tester. Create a Sandbox tester (Users and Access, Sandbox) for purchase tests.

## 3. Supabase (the shared project: Authentication settings)

The project is shared with other live products. Every change here is additive: never remove or replace another product's value.

1. **Authentication, URL Configuration, Redirect URLs**: **Add URL** `holler://auth-callback`. Save.
2. **Authentication, Sign In / Providers, Apple**: in **Client IDs**, ADD `com.localholler.app` to the comma-separated list (keep every id already there). This is the audience of the id token Apple gives the iPhone app; without it sign-in fails with "Unacceptable audience in id_token". Save.
3. Shared-project limits, read before turning social sign-in on:
   - a. Apple on iPhone (native) shows "Holler" on Apple's sheet. Safe to turn on: `VITE_APPLE_SIGN_IN=true`.
   - b. Apple on Android and Google on both platforms go through the web OAuth flow, which uses the ONE Services ID (Apple) and the ONE Google OAuth client configured in this shared project. The consent screen then shows that client's product name, not Holler. If that is another product's name, keep `VITE_GOOGLE_SIGN_IN=false` until Holler has its own Supabase project or the shared clients are renamed to a neutral company name.
   - c. If you do turn Google on: the Google Cloud OAuth client must list `https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect URI (it already does if Google sign-in works for the other product).
4. Keys for the app (Project Settings, API): copy the **Project URL** into `VITE_SUPABASE_URL` and the **anon / publishable** key into `VITE_SUPABASE_ANON_KEY`. Never the service role or a secret key: the build refuses them.
5. Email: nothing to change. The app signs people up through the website's own route, so Supabase's own confirmation email is never sent for Holler.

## 4. RevenueCat (app.revenuecat.com)

1. **Create project** `Holler`.
2. **Apps, + App Store**: name `Holler iOS`, bundle id `com.localholler.app`. Upload the **In-App Purchase key** `.p8` from step 2.7 with its Key ID and Issuer ID. Copy the Apple notification URL it shows into App Store Connect (step 2.6).
3. **Apps, + Play Store**: name `Holler Android`, package `com.localholler.app`. Upload the Google service account JSON from step 6.6. Set up Real-time developer notifications as RevenueCat shows (a Pub/Sub topic it gives you, entered in Play Console, Monetization setup).
4. **Products**: import the four App Store products and the four Play subscriptions (Play ids show as `com.localholler.app.solo.monthly:monthly` and so on; that suffix is expected and handled).
5. **Entitlements**: create `solo` and attach both Solo products of both stores. Create `pro` and attach both Pro products of both stores.
6. **Offerings**: create `default`, mark it **Current**. Add four packages with custom identifiers `solo_monthly`, `solo_annual`, `pro_monthly`, `pro_annual`, each holding the matching App Store and Play product. (The app reads the plan from the product id and the period from the product, so custom package identifiers are fine.)
7. **Project settings, API keys**: copy the public **App Store** key (`appl_...`) into `VITE_REVENUECAT_IOS_KEY` and the public **Play Store** key (`goog_...`) into `VITE_REVENUECAT_ANDROID_KEY`. Never the secret `sk_` key.
8. **Integrations, Webhooks, + New**: URL `https://localholler.com/api/revenuecat/webhook`. Authorization header value: a long random string you generate (for example `openssl rand -hex 32` in Terminal). Put the same string in Vercel as `REVENUECAT_WEBHOOK_SECRET` (Production). Environment: both production and sandbox (App Review buys in sandbox). Events: all. Sandbox purchases give a plan only while `REVENUECAT_ALLOW_SANDBOX` is `1` in Vercel (see section 7 and LAUNCH.md).
9. App user ids: the app logs in with the Supabase user id, so RevenueCat customers are named by that id. Nothing to configure.
10. **Project settings, Restore behavior**: leave it on the default (transfer to the new App User ID). What the member sees: when they tap Restore purchases while signed in to a second Holler account, the paid plan moves to that account right away, with the same plan and end date, and the first account loses it. A subscription that has already ended moves nothing.

## 5. Firebase (console.firebase.google.com)

1. **Add project** `Holler` (or open an existing ColorLabPro project). Google Analytics: **off** (the app does no analytics).
2. **Add app, iOS**: bundle id `com.localholler.app`, nickname `Holler iOS`. Download **GoogleService-Info.plist**. Skip the SDK steps (already done). Put the file in Xcode as RELEASE.md step I3 says.
3. **Add app, Android**: package `com.localholler.app`, nickname `Holler Android`. Download **google-services.json**. Put it at `mobile/android/app/google-services.json` (RELEASE.md step A4).
4. **Project settings, Cloud Messaging, Apple app configuration**: upload the APNs auth key `.p8` from step 1.2 with its Key ID and Team ID `B3B65JKTQ7`.
5. **Project settings, Service accounts, Generate new private key**. This JSON is a SECRET. Put its full content in Vercel as `FIREBASE_SERVICE_ACCOUNT_JSON` (Production), then delete the downloaded file. It never goes in the app or the repo.
6. After both config files are in place: set `VITE_PUSH_ENABLED=true` in `mobile/.env.production.local`, run RELEASE.md step 3, rebuild both apps.

## 6. Google Play Console (play.google.com/console)

1. **Create app**: name `Holler`, default language English (United States), App, Free. Accept the declarations.
2. **App integrity, Play App Signing**: keep Google-managed signing (default). Your first upload registers the upload key from RELEASE.md step A1.
3. **Monetization, Subscriptions**: create four subscriptions. Product id exactly as below, each with ONE auto-renewing base plan, US price, renewal type auto-renewing, grace period on:

   | Product id | Name | Base plan id | Billing period | Price (US) |
   |---|---|---|---|---|
   | `com.localholler.app.solo.monthly` | Holler Solo (monthly) | `monthly` | 1 month | $7.99 |
   | `com.localholler.app.solo.yearly` | Holler Solo (yearly) | `yearly` | 1 year | $79.99 |
   | `com.localholler.app.pro.monthly` | Holler Pro (monthly) | `monthly` | 1 month | $13.99 |
   | `com.localholler.app.pro.yearly` | Holler Pro (yearly) | `yearly` | 1 year | $139.99 |

   Free trial offer: same owner decision as App Store step 2.5. If you add one, make it a 14-day free phase with eligibility "New customer acquisition, never had any subscription". Activate each base plan.
4. **Store presence, Main store listing**: short and full description, icon (512 x 512, export from `mobile/assets/icon-only.png`), feature graphic, phone screenshots.
5. **App content**: Privacy policy URL `https://localholler.com/privacy`. Ads: no. App access: give the same demo account as App Review. Target audience: 18 and over. Data safety: collects name (from Apple or Google sign-in, and the business name), email address, user ids, approximate location (ZIP), purchase history, other financial info (the optional job amount), other user-generated content (keyword watches), app interactions, device id (push token); all for app functionality (user ids and app interactions also for analytics, first-party only), all encrypted in transit, users can request deletion (in-app Delete account and the website). No data shared with third parties for advertising. Account deletion URL: `https://localholler.com/app/settings`.
6. **Setup, API access**: link a Google Cloud project, create a service account, grant it in Play Console **View app information** and **Manage orders and subscriptions** (Financial data: view). Download its JSON key and upload it to RevenueCat (step 4.3). That JSON is a SECRET: delete the download after uploading.
7. **Testing, Internal testing**: create a release with the AAB from RELEASE.md step A5, add testers by email. **Setup, License testing**: add the same Google accounts so purchases are test purchases.

## 7. Vercel (server side, owned by the MOBILE-API unit; listed here so nothing is missed)

| Name | From |
|---|---|
| `REVENUECAT_WEBHOOK_SECRET` | the string you made in step 4.8 |
| `REVENUECAT_ALLOW_SANDBOX` | `1` while TestFlight, license testing or App Review needs sandbox purchases to give a plan. Empty otherwise. Redeploy after each change. Not a secret. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | the Firebase service account JSON from step 5.5 |

The webhook secret and the service account JSON are secrets. Never put either in `mobile/.env*`.
