import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn(), actorCanViewOperations: vi.fn(), listActorAccessibleFacilityIds: vi.fn() }));
import { requireOperationsActor, actorCanAccessFacility, actorCanViewOperations, listActorAccessibleFacilityIds } from "@/lib/operations/auth";
import { GET } from "./route";
const from = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor: { currentActor: { client: { from } } } } as never);
  vi.mocked(actorCanViewOperations).mockReturnValue(true);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  vi.mocked(listActorAccessibleFacilityIds).mockResolvedValue(["site"]);
});
it("does not infer whole-site staffing or an all-clear from a potentially restricted task subset", async () => {
  const response = await GET(new Request("https://haven.test/staffing"));
  expect(response.status).toBe(409);
  const payload = await response.json();
  expect(payload.coverage.completeness).toBe("unverified");
  expect(payload).not.toHaveProperty("adequacy_score");
  expect(payload).not.toHaveProperty("pending_task_count");
  expect(from).not.toHaveBeenCalled();
});
it("returns denied without assessment or counts when site access is revoked", async () => {
  vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
  expect((await GET(new Request("https://haven.test/staffing?facility_id=site"))).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
});
