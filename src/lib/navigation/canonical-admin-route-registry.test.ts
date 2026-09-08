/// <reference types="vite/client" />

import { normalizeAppPath } from "next/dist/shared/lib/router/utils/app-paths";
import { describe, expect, it, vi } from "vitest";

import nextConfig from "../../../next.config";
import { repairedRoutes, resolveRedirect } from "../../../scripts/verify-section-1-routes.mjs";

// Keep application dependencies out of this route-module contract. Each canonical
// import must expose the existing page component itself, with no second implementation.
vi.mock("@sentry/nextjs", () => ({ withSentryConfig: (config: unknown) => config }));
vi.mock("@next/bundle-analyzer", () => ({ default: () => (config: unknown) => config }));
vi.mock("@/app/(admin)/finance/forecast/page", () => ({ default: () => "forecast" }));
vi.mock("@/app/(admin)/finance/close/page", () => ({ default: () => "close" }));
vi.mock("@/app/(admin)/finance/trust/page", () => ({ default: () => "trust" }));
vi.mock("@/app/(admin)/reports/history/[id]/page", () => ({ default: () => "report" }));
vi.mock("@/app/(admin)/training/inservice/new/page", () => ({ default: () => "inservice" }));
vi.mock("@/app/(admin)/transportation/requests/new/page", () => ({ default: () => "new trip" }));
vi.mock("@/app/(admin)/transportation/requests/[id]/page", () => ({ default: () => "trip" }));

const pageModules = import.meta.glob("/src/app/**/page.tsx");

describe("canonical admin route repairs", () => {
  it.each(repairedRoutes)("resolves %s to its existing implementation through the actual canonical module", async (route) => {
    const canonicalKey = `/src/app/(admin)/admin/${route}/page.tsx`;
    const legacyKey = `/src/app/(admin)/${route}/page.tsx`;
    expect(pageModules[canonicalKey], `missing canonical page ${canonicalKey}`).toBeTypeOf("function");
    const canonical = await pageModules[canonicalKey]() as { default: unknown };
    const legacy = await pageModules[legacyKey]() as { default: unknown };
    expect(canonical.default).toBe(legacy.default);
    expect(normalizeAppPath(`/(admin)/admin/${route}/page`)).toBe(`/admin/${route}`);
  });

  it.each(repairedRoutes)("resolves the configured legacy redirect to %s without another redirect", async (route) => {
    const redirects = await nextConfig.redirects!();
    const legacy = `/${route.replace("[id]", "section-1-record")}`;
    const destination = resolveRedirect(redirects, legacy);
    expect(destination).toBe(`/admin${legacy}`);
    expect(resolveRedirect(redirects, destination!)).toBeNull();
  });
});
