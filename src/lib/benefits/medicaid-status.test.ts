import { describe, expect, it, vi } from "vitest";

import { loadMedicaidStatuses } from "./medicaid-status";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";

describe("loadMedicaidStatuses", () => {
  it("asks once for unique valid ids and maps the reply", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resident_id: a, case_id: null, kind: "screening", label: "Does not qualify now" }], error: null });
    const map = await loadMedicaidStatuses({ rpc } as never, [a, a, "not-a-uuid", b]);
    expect(rpc).toHaveBeenCalledWith("benefits_medicaid_status", { p_resident_ids: [a, b] });
    expect(map?.get(a)?.label).toBe("Does not qualify now");
    expect(map?.has(b)).toBe(false);
  });
  it("returns null (show nothing) without access or on an unverifiable reply", async () => {
    expect(await loadMedicaidStatuses({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } }) } as never, [a])).toBeNull();
    expect(await loadMedicaidStatuses({ rpc: vi.fn().mockResolvedValue({ data: [{ nope: 1 }], error: null }) } as never, [a])).toBeNull();
  });
  it("does not call the database with no residents", async () => {
    const rpc = vi.fn();
    expect((await loadMedicaidStatuses({ rpc } as never, []))?.size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
