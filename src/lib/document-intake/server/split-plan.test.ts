import { describe, expect, it } from "vitest";

import { deriveRequestKey } from "./request-key";
import { prepareSplitResultSchema, splitPlanProblem } from "./split-plan";

const requestKey = "00000000-0000-4000-8000-000000000011";

describe("splitPlanProblem", () => {
  it("accepts a plan that places each page once", () => {
    expect(splitPlanProblem([{ pages: [1, 2] }, { pages: [4] }], [3])).toBeNull();
    expect(splitPlanProblem([{ pages: [3, 1] }, { pages: [2] }], [], 3)).toBeNull();
  });

  it("refuses a page placed twice, across parts or in the excluded list", () => {
    expect(splitPlanProblem([{ pages: [1, 2] }, { pages: [2] }], [])).toMatch(/Page 2/);
    expect(splitPlanProblem([{ pages: [1] }], [1])).toMatch(/Page 1/);
  });

  it("with a known page count, refuses missing or out-of-range pages", () => {
    expect(splitPlanProblem([{ pages: [1] }], [], 3)).toMatch(/exactly one part/);
    expect(splitPlanProblem([{ pages: [1, 2, 3, 4] }], [], 3)).toMatch(/Page 4/);
  });

  it("parses the prepare_split result and refuses a malformed one", () => {
    const good = {
      parent_revision: "d4bf39e9-97d6-431d-86c8-8a8518fc6a84",
      children: [{ item_id: "a4875598-cb64-4279-9d23-46a728c6dafd", path: "org/fac/item/split-1", pages: [1, 2] }],
    };
    expect(prepareSplitResultSchema.safeParse(good).success).toBe(true);
    expect(prepareSplitResultSchema.safeParse({ ...good, children: [] }).success).toBe(false);
    expect(prepareSplitResultSchema.safeParse({ ...good, children: [{ ...good.children[0], pages: [] }] }).success).toBe(false);
  });
});

describe("deriveRequestKey", () => {
  it("is a deterministic v5-shaped UUID per request key and step", () => {
    const key = deriveRequestKey(requestKey, "finalize");
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveRequestKey(requestKey, "finalize")).toBe(key);
    expect(deriveRequestKey(requestKey.toUpperCase(), "finalize")).toBe(key);
  });

  it("differs by step and by request key, and never equals the input", () => {
    const key = deriveRequestKey(requestKey, "finalize");
    expect(deriveRequestKey(requestKey, "complete")).not.toBe(key);
    expect(deriveRequestKey("00000000-0000-4000-8000-000000000012", "finalize")).not.toBe(key);
    expect(key).not.toBe(requestKey);
  });
});
