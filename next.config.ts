import type { NextConfig } from "next";
import { securityHeaderRules } from "./lib/security-headers";
import { contentLanguageRules } from "./lib/i18n/seo";

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

export default nextConfig;
