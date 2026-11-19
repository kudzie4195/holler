import type { CapacitorConfig } from '@capacitor/cli';

// Holler native shell. The built Vite app (dist/) ships inside the binary and is served from
// capacitor://localhost (iOS) and https://localhost (Android). There is no server.url on purpose:
// a remote URL would make App Review treat the app as a website wrapper (guideline 4.2).
//
// appId is the iOS bundle id AND the Android applicationId. Do not change it after the
// App Store Connect and Play Console records exist.
const config: CapacitorConfig = {
  appId: 'com.localholler.app',
  appName: 'Holler',
  webDir: 'dist',
  ios: {
    // The web layer pads itself with env(safe-area-inset-*), so the WebView itself is not inset.
    contentInset: 'never',
  },
  android: {
    // Release builds never accept cleartext or mixed content.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#FAF8F3',
      showSpinner: false,
    },
    SystemBars: {
      // Android: edge to edge, with the real insets injected as --safe-area-inset-* (styles.css reads them).
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      // Dark status bar icons on the light background.
      style: 'LIGHT',
    },
    FirebaseMessaging: {
      // Banner, sound and badge while the app is open too.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // fetch() stays the WebView's own. The API client calls CapacitorHttp explicitly on native
    // (lib/http.ts) so the Supabase client and everything else keep the browser stack.
    CapacitorHttp: {
      enabled: false,
    },
  },
  experimental: {
    ios: {
      spm: {
        // capawesome-team/capacitor-firebase#959: avoids a SwiftPM package identity collision.
        packageOptions: {
          '@capacitor-firebase/messaging': { symlink: true },
        },
      },
    },
  },
};

export default config;
