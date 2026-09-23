import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHARED_DEVICE_NO_STORE_HEADERS } from "./shared-device-headers";

/** next.config `source` matching, enough for these patterns (`:path*`). */
function matches(source: string, pathname: string): boolean {
  if (source.endsWith("/:path*")) {
    const prefix = source.slice(0, -"/:path*".length);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }
  return source === pathname;
}

function cacheControlFor(pathname: string): string | null {
  const entry = SHARED_DEVICE_NO_STORE_HEADERS.find((rule) => matches(rule.source, pathname));
  return entry?.headers.find((header) => header.key === "Cache-Control")?.value ?? null;
}

describe("shared-device Cache-Control (COL-677, spec 40 §5)", () => {
  it.each(["/floor", "/floor/lock", "/floor/setup", "/floor/residents/abc", "/kiosk", "/kiosk/staff", "/kiosk/sign-in/visitor", "/kiosk/leaving"])(
    "%s answers no-store",
    (pathname) => {
      expect(cacheControlFor(pathname)).toBe("no-store");
    },
  );

  it("leaves other pages alone", () => {
    for (const pathname of ["/", "/floorplan", "/kiosks", "/admin", "/caregiver"]) {
      expect(cacheControlFor(pathname), pathname).toBeNull();
    }
  });

  it("is wired into next.config headers()", () => {
    const config = fs.readFileSync(path.resolve(__dirname, "../../../next.config.ts"), "utf8");
    expect(config).toContain('import { SHARED_DEVICE_NO_STORE_HEADERS } from "./src/lib/routing/shared-device-headers"');
    expect(config).toMatch(/async headers\(\)[\s\S]*\.\.\.SHARED_DEVICE_NO_STORE_HEADERS/);
  });
});
