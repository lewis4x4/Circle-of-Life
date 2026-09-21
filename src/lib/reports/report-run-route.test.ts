import { expect, it } from "vitest";

import { classifyReportRunSource } from "./report-run-route";

const UUID = "a1b2c3d4-e5f6-4a70-8b9c-0d1e2f3a4b5c";

it("does not treat saved_view UUID as a template slug (original failure)", () => {
  const classified = classifyReportRunSource("saved_view", UUID);
  expect(classified).toEqual({ kind: "saved_view", viewId: UUID });
  expect(classified.kind).not.toBe("template");
});

it("rejects invalid saved_view id", () => {
  expect(classifyReportRunSource("saved_view", "census")).toEqual({
    kind: "invalid_saved_view",
  });
});

it("keeps template slug routes working", () => {
  expect(classifyReportRunSource("template", "census")).toEqual({
    kind: "template",
    slug: "census",
  });
});

it("classifies pack UUID and rejects bad pack ids", () => {
  expect(classifyReportRunSource("pack", UUID)).toEqual({ kind: "pack", packId: UUID });
  expect(classifyReportRunSource("pack", "not-uuid")).toEqual({ kind: "invalid_pack" });
});
