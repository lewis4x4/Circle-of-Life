import path from "path";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { LEGACY_REDIRECTS } from "./src/lib/routing/legacy-redirects";
import { SHARED_DEVICE_NO_STORE_HEADERS } from "./src/lib/routing/shared-device-headers";
import { supabaseCspOrigins } from "./src/lib/supabase/env";

// `__dirname` is undefined when this file is loaded as ESM (Next 16 + .ts config).
// Resolve it explicitly so Turbopack's `root:` gets an absolute path that works
// regardless of how the file was loaded (CJS or ESM) and regardless of whether
// the worktree path contains spaces.
const __dirname_resolved = (() => {
  try {
    // ESM path
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    // CJS fallback (in case Next compiles to CJS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__dirname ?? process.cwd();
  }
})();

const isProd = process.env.NODE_ENV === "production";

const supabaseOrigins = supabaseCspOrigins(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim());
const sentryHost = [process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.SENTRY_DSN]
  .map((dsn) => {
    if (!dsn) return "";
    try {
      return new URL(dsn).host;
    } catch {
      return "";
    }
  })
  .find(Boolean);

const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://images.unsplash.com${supabaseOrigins.http ? ` ${supabaseOrigins.http}` : ""}`,
  "media-src 'self' https://cdn.pixabay.com",
  "font-src 'self'",
  `connect-src 'self'${supabaseOrigins.http ? ` ${supabaseOrigins.http} ${supabaseOrigins.websocket}` : ""}${sentryHost ? ` https://${sentryHost}` : ""}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
];

const securityHeaders: { key: string; value: string }[] = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
];

if (isProd) {
  securityHeaders.unshift({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // sharp is a native addon, so the server build must require it at runtime
  // rather than bundle it. It is declared in dependencies for the same reason
  // the build broke without it: see COL-479.
  serverExternalPackages: ["sharp"],
  // Match npm run typecheck; Vitest executes test fixtures independently.
  typescript: { tsconfigPath: "tsconfig.typecheck.json" },
  experimental: {
    // Keep shared modules reusable instead of copying them into route bundles.
    // Default merge heuristics duplicated >2.6 MB across this route set.
    turbopackChunking: { minChunkSize: 25_000 },
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "date-fns-tz",
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@base-ui/react",
      "@tanstack/react-table",
      "@tanstack/react-virtual",
    ],
  },
  turbopack: {
    root: __dirname_resolved,
  },
  // Short-path aliases and legacy URLs: see src/lib/routing/legacy-redirects.ts.
  async redirects() {
    return LEGACY_REDIRECTS;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
      // Shared floor tablets and the front-door kiosk: no page is ever cached.
      // See src/lib/routing/shared-device-headers.ts.
      ...SHARED_DEVICE_NO_STORE_HEADERS,
    ];
  },
};

import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  // Write the static HTML report to a stable location that the Homewood
  // perf-baseline script can copy into docs/homewood/ after a build.
  openAnalyzer: false,
  analyzerMode: "static",
});

export default withBundleAnalyzer(
  withSentryConfig(nextConfig, {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: true,
  }),
);
