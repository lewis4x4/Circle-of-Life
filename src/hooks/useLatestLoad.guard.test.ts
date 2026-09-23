import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * COL-682: a cookie-bootstrapped client (it skips its first load because the
 * server already rendered the cookie's facility) reloads when the facility store
 * hydrates, so two reads can overlap. Every such client must let only the latest
 * read write state, or a stale unscoped read (its no-facility error) lands under
 * the selected facility (COL-673). Accepted guards: useLatestLoad (the shared
 * hook), the roster's loadSequenceRef, a request generation or sequence counter, or an
 * isCurrent callback passed by an effect that cancels on cleanup.
 */
const SRC = path.resolve(import.meta.dirname, "..");
const GUARDS = [/\buseLatestLoad\(\)/, /\bloadSequenceRef\b/, /\brequestGeneration\b/, /\brequestSequence\b/, /isCurrent: \(\) => boolean/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "useLatestLoad.ts") out.push(full);
  }
  return out;
}

describe("cookie-bootstrapped clients keep the latest read (COL-682)", () => {
  it("every client with skipNextLoadRef also has a latest-read guard", () => {
    const unguarded = walk(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("skipNextLoadRef"))
      .filter((file) => !GUARDS.some((guard) => guard.test(readFileSync(file, "utf8"))))
      .map((file) => path.relative(path.resolve(SRC, ".."), file));
    expect(unguarded).toEqual([]);
  });

  it("every useLatestLoad client checks isCurrent after its reads", () => {
    const missing = walk(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("useLatestLoad()"))
      .filter((file) => !/if \(!isCurrent\(\)\) return;/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(path.resolve(SRC, ".."), file));
    expect(missing).toEqual([]);
  });
});
