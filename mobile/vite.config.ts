import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  // The version shown in Settings and sent with the push token: package.json, the single source (RELEASE.md, version parity).
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  // Relative asset URLs: the bundle is served from capacitor://localhost and https://localhost.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      // @capacitor-firebase/messaging lazy-loads a web implementation that imports the Firebase JS SDK.
      // This app never uses web push, so that import resolves to a stub instead of shipping the SDK.
      'firebase/messaging': path.resolve(here, 'src/stubs/firebase-messaging.ts'),
    },
  },
  build: {
    outDir: 'dist',
    target: ['es2020', 'safari15', 'chrome90'],
    sourcemap: false,
    // One local bundle read from disk on the phone; Supabase and React dominate it.
    chunkSizeWarningLimit: 800,
  },
});
