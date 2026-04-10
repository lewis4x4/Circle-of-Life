import path from "path";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

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
  turbopack: {
    root: path.resolve(__dirname),
  },
  /** Route group `(admin)` omits `admin` from the path; `/dietary` would bypass shell URL expectations. */
  async redirects() {
    return [
      { source: "/dietary", destination: "/admin/dietary", permanent: true },
      { source: "/dietary/:path*", destination: "/admin/dietary/:path*", permanent: true },
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

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
});
