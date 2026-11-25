import type { NextConfig } from "next";
import { securityHeaderRules } from "./lib/security-headers";
import { contentLanguageRules } from "./lib/i18n/seo";

const nextConfig: NextConfig = {
  /* config options here */
  poweredByHeader: false,
  // Round 34: the road-words switch (lib/signals/carry.ts roadWordsEnabled) is read by label code that runs in the server AND the browser (the feed card).
  // Listing it here makes Next replace process.env.HOLLER_ROAD_WORDS_ENABLED with the build's value in both bundles, so they cannot disagree.
  env: { HOLLER_ROAD_WORDS_ENABLED: process.env.HOLLER_ROAD_WORDS_ENABLED ?? '' },
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

export default nextConfig;
