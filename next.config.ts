import type { NextConfig } from "next";
import { securityHeaderRules } from "./lib/security-headers";
import { contentLanguageRules } from "./lib/i18n/seo";
import { inlinedSwitchEnv } from "./lib/build-switches";

const nextConfig: NextConfig = {
  /* config options here */
  poweredByHeader: false,
  // Security pass r16 SEC-1: clickjacking, nosniff, referrer and permissions headers on every path (lib/security-headers.ts).
  async headers() {
    // Global hardening first, then Referrer-Policy: no-referrer on token pages (the later entry wins for the same key).
    // The Spanish public pages (r17 ES) also say so in the response: the shared root layout writes <html lang="en">.
    return [...securityHeaderRules(), ...contentLanguageRules()];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Round 34 switch audit: the switches the browser reads (lib/build-switches.ts INLINED_SWITCHES) are inlined at build, so the server and the
// browser bundle hold the same value ("1" or ""). Merged into any `env` the object above declares, so another switch added there is kept.
nextConfig.env = { ...nextConfig.env, ...inlinedSwitchEnv(process.env) };

export default nextConfig;
