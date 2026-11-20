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
    react(),
  ],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  base: './',
  resolve: {
    alias: {
      '@': path.join(mobile, 'src'),
      'firebase/messaging': path.join(mobile, 'src/stubs/firebase-messaging.ts'),
      '@revenuecat/purchases-capacitor': path.join(here, 'shims/purchases-mock.ts'),
    },
  },
  build: { outDir: path.join(here, '.gen/dist', plat), emptyOutDir: true, target: ['es2020', 'chrome90'], sourcemap: false, chunkSizeWarningLimit: 2000 },
});
