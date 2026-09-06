/** Opt-in, console-only startup timings. Never records URLs, query strings or record data. */
const enabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("haven_perf") === "1";

export type StartupStage = "instrumentation" | "route-transition" | "auth-start" | "session-ready" | "profile-ready" | "auth-ready" | "auth-event" | "executive-mounted" | "executive-fetch-start" | "executive-fetch-end";

type TimedResource = Pick<PerformanceResourceTiming, "name" | "initiatorType" | "startTime" | "duration" | "transferSize">;

export function summarizeStartupResources(entries: TimedResource[]) {
  return entries.map((entry) => {
    let kind = "other";
    try {
      const path = new URL(entry.name).pathname;
      if (path.startsWith("/auth/")) kind = "auth";
      else if (path.startsWith("/rest/")) kind = "database";
      else if (path.endsWith(".js")) kind = "javascript";
      else if (path.endsWith(".css")) kind = "stylesheet";
      else if (/\.(woff2?|ttf)$/.test(path)) kind = "font";
      else if (/\.(png|jpe?g|webp|svg|ico)$/.test(path)) kind = "image";
      else if (entry.initiatorType === "fetch") kind = "app-request";
    } catch { /* Classification failure must never affect application startup. */ }
    return { kind, startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration), bytes: entry.transferSize };
  }).sort((a, b) => b.durationMs - a.durationMs).slice(0, 30);
}

export function startupMark(stage: StartupStage) {
  if (!enabled) return;
  try { console.info("[HavenPerf]", JSON.stringify({ stage, atMs: Math.round(performance.now()) })); } catch { /* diagnostics only */ }
}

export function startStartupTrace() {
  if (!enabled) return;
  startupMark("instrumentation");
  let longTaskCount = 0;
  let longTaskMs = 0;
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) { longTaskCount++; longTaskMs += entry.duration; }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch { /* Long-task entries are not supported in every browser. */ }

  for (const delay of [5_000, 15_000]) {
    window.setTimeout(() => {
      try {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        console.info("[HavenPerf]", JSON.stringify({
          stage: "summary", atMs: Math.round(performance.now()),
          navigation: nav ? { responseStartMs: Math.round(nav.responseStart), responseEndMs: Math.round(nav.responseEnd), domInteractiveMs: Math.round(nav.domInteractive), loadMs: Math.round(nav.loadEventEnd), bytes: nav.transferSize, workerStartMs: Math.round(nav.workerStart) } : null,
          paint: performance.getEntriesByType("paint").map(entry => ({ name: entry.name, atMs: Math.round(entry.startTime) })),
          longTaskCount, longTaskMs: Math.round(longTaskMs),
          slowestResources: summarizeStartupResources(performance.getEntriesByType("resource") as PerformanceResourceTiming[]),
        }));
      } catch { /* A failed diagnostic cannot break the page. */ }
      if (delay === 15_000) observer?.disconnect();
    }, delay);
  }
}
