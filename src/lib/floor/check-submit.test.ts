import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pwa/rounding-sync", () => ({
  queueRoundingCompletion: vi.fn(() => Promise.resolve()),
  shouldQueueRoundingRequest: () => false,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { saveFloorCheck } from "./check-submit";

const OWNER = { userId: "u", sessionId: "s", organizationId: "o", facilityId: "f" };
const input = { taskId: "task-1", residentId: "r-1", draft: { quickStatus: "awake" as const }, owner: OWNER, requestId: "req-1", observedAt: "2026-09-23T13:40:00Z" };

afterEach(() => vi.unstubAllGlobals());

describe("saveFloorCheck", () => {
  it("never shows the route's own error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "chipSelections must map a chip group to a list of codes" }), { status: 400 }))));
    const result = await saveFloorCheck(input);
    expect(result).toEqual({ status: "failed", message: "This check could not be saved as charted. Check the answers, then try again." });
  });

  it("asks for the late reason when the route requires one", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "x", reasonRequired: true }), { status: 400 }))));
    expect(await saveFloorCheck(input)).toEqual({ status: "reason_required", message: "This check is late. Say why, then save." });
  });
});
