import path from "path";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

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

const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
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
  `img-src 'self' data: blob:${supabaseHost ? ` https://${supabaseHost}` : ""}`,
  "font-src 'self'",
  `connect-src 'self'${supabaseHost ? ` https://${supabaseHost} wss://${supabaseHost}` : ""}${sentryHost ? ` https://${sentryHost}` : ""}`,
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
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
    ],
  },
  turbopack: {
    root: __dirname_resolved,
  },
  /**
   * Route group `(admin)` omits `admin` from the path; `/training` etc. would bypass `/admin/...` URL expectations.
   * Only segments with both `(admin)/<segment>/page.tsx` and `admin/<segment>/page.tsx` are listed.
   */
  async redirects() {
    const segments = [
      "billing",
      "certifications",
      // "dietary" intentionally omitted — /dietary is the dedicated Lead Cook
      // Command Deck at (dietary)/dietary/page.tsx, not a redirect to admin.
      // Admin dietary hub remains at /admin/dietary (direct path).
      "executive",
      "finance",
      "incidents",
      "insurance",
      "payroll",
      "reports",
      "reputation",
      "residents",
      "schedules",
      "search",
      "staff",
      "staffing",
      "time-records",
      "training",
      "transportation",
      "vendors",
    ];
    return [
      ...segments.flatMap((seg) => [
        { source: `/${seg}`, destination: `/admin/${seg}`, permanent: true },
        { source: `/${seg}/:path*`, destination: `/admin/${seg}/:path*`, permanent: true },
      ]),
      {
        source: "/admin/reports-hub/haven-insight",
        destination: "/admin/reports/nlq",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
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
