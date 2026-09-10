import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn() }));
import { requireOperationsActor } from "@/lib/operations/auth";
import { POST } from "./route";

const from = vi.fn();
const rpc = vi.fn();
describe("bulk completion release boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not read or complete any tasks through the excluded bulk path", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValue({ actor: { currentActor: { client: { from, rpc } } } } as never);
    const response = await POST();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Complete tasks individually" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("retains the authentication boundary", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValue({ response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) });
    expect((await POST()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
