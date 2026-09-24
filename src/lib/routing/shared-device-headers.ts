/**
 * Cache-Control for the shared-device surfaces (COL-677, spec 40 §5): every
 * floor tablet and front-door kiosk page answers `no-store`.
 *
 * Applied from `next.config.ts` `headers()`, so it reaches the HTML document
 * on `/kiosk`, which the proxy never sees. Next only fills Cache-Control on a
 * page response when none is set yet (server/send-payload), so this wins over
 * the static-page default. `/floor` pages also get it from the proxy.
 */
export const SHARED_DEVICE_NO_STORE_SOURCES = ["/floor", "/floor/:path*", "/kiosk", "/kiosk/:path*"] as const;

export const SHARED_DEVICE_NO_STORE_HEADERS: { source: string; headers: { key: string; value: string }[] }[] =
  SHARED_DEVICE_NO_STORE_SOURCES.map((source) => ({
    source,
    headers: [{ key: "Cache-Control", value: "no-store" }],
  }));
