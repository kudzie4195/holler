// Capture-only Vite config. Builds the real app (mobile/src untouched) with two swaps: src/lib/platform.ts and the RevenueCat plugin.
// Usage: SHOT_PLATFORM=ios|android VITE_API_BASE=... VITE_SUPABASE_URL=... npx vite build -c store/vite.capture.config.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '..');
const plat = process.env.SHOT_PLATFORM === 'android' ? 'android' : 'ios';
const pkg = JSON.parse(readFileSync(path.join(mobile, 'package.json'), 'utf8'));
const platformFile = path.join(mobile, 'src/lib/platform.ts');

export default defineConfig({
  root: mobile,
  envDir: here, // no env files exist here; values come from the command line
  plugins: [
    {
      name: 'capture-platform-shim',
      enforce: 'pre',
      async resolveId(source, importer, opts) {
        if (!importer || !source.includes('platform')) return null;
        const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
        return r && path.resolve(r.id) === platformFile ? path.join(here, `shims/platform-${plat}.ts`) : null;
      },
    },
    {
      // Desktop Chrome has no native bridge, so the real services.ts would turn push off (isNative() is false). The capture keeps
      // the build flag as the only switch, and the native plugin is the stand-in in shims/messaging-mock.ts. Nothing else changes.
      name: 'capture-push-on',
      enforce: 'pre',
      transform(code, id) {
        if (path.resolve(id) !== path.join(mobile, 'src/services.ts')) return null;
        const from = 'enabled: config.flags.push && isNative(),';
        if (!code.includes(from)) throw new Error('capture-push-on: services.ts changed; update store/vite.capture.config.mjs');
        return code.replace(from, 'enabled: config.flags.push,');
      },
    },
    react(),
  ],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  base: './',
  resolve: {
    alias: {
      '@': path.join(mobile, 'src'),
      'firebase/messaging': path.join(mobile, 'src/stubs/firebase-messaging.ts'),
      '@revenuecat/purchases-capacitor': path.join(here, 'shims/purchases-mock.ts'),
      '@capacitor-firebase/messaging': path.join(here, 'shims/messaging-mock.ts'),
    },
  },
  build: { outDir: path.join(here, '.gen/dist', plat), emptyOutDir: true, target: ['es2020', 'chrome90'], sourcemap: false, chunkSizeWarningLimit: 2000 },
});
