import { describe, expect, it } from "vitest";

import { scanSource } from "./false-all-clear-scan";

const rules = (file: string, source: string) => scanSource(file, source).map((f) => f.rule);

describe("false-all-clear scan", () => {
  it("flags ?? 0 and || 100 rendered through JSX", () => {
    expect(rules("a.tsx", `export const A = ({ s }) => <p>{s?.overdue ?? 0}</p>;`)).toEqual(["silent-zero"]);
    expect(rules("a.tsx", `export const A = ({ s }) => <Card value={s.pct || 100} />;`)).toEqual(["silent-zero"]);
    expect(rules("a.tsx", `export const A = ({ s }) => <p>{fmt(s.total ?? 0)}</p>;`)).toEqual(["silent-zero"]);
  });

  it("ignores arithmetic inside handlers and non-JSX code", () => {
    expect(rules("a.tsx", `export const A = () => <button onClick={() => set((p) => (p ?? 0) + 1)} />;`)).toEqual([]);
    expect(rules("a.tsx", `const n = x ?? 0; export const A = () => <p>{n}</p>;`)).toEqual([]);
    expect(rules("a.tsx", `export const A = ({ s }) => <p>{s.label ?? "—"}</p>;`)).toEqual([]);
  });

  it("flags count ?? 0 anywhere", () => {
    expect(rules("a.ts", `const { count } = await q; return count ?? 0;`)).toEqual(["count-or-zero"]);
  });

  it("flags an empty list mapped to a green state", () => {
    expect(rules("a.ts", `if (certs.length === 0) return "current";`)).toEqual(["empty-is-ok"]);
    expect(rules("a.ts", `const s = rows.length === 0 ? "clear" : "open";`)).toEqual(["empty-is-ok"]);
  });

  it("flags reassuring copy unless the file asks canClaimAllClear", () => {
    expect(rules("a.tsx", `export const A = () => <p>All Clear</p>;`)).toEqual(["all-clear-copy"]);
    expect(rules("a.tsx", `export const A = () => <p>In good standing</p>;`)).toEqual(["all-clear-copy"]);
    expect(
      rules(
        "a.tsx",
        `import { canClaimAllClear } from "@/lib/metrics/metric-state";
         export const A = ({ ok }) => (ok ? <p>All Clear</p> : null);`,
      ),
    ).toEqual([]);
  });

  it("skips comments", () => {
    expect(rules("a.ts", `// never return count ?? 0 here\n/** All clear is gated */`)).toEqual([]);
  });
});
