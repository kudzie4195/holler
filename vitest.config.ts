import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The Capacitor app runs its own tests (cd mobile && npm test).
    exclude: [...configDefaults.exclude, 'mobile/**'],
  },
});
