import { describe, expect, it, vi } from "vitest";

import { dollarsToCents, evidencePath, recordPaymentOnHome } from "@/lib/home/record-payment";

describe("dollarsToCents", () => {
  it("reads what an administrator types", () => {
    expect(dollarsToCents("1,234.50")).toBe(123450);
    expect(dollarsToCents("$2400")).toBe(240000);
    expect(dollarsToCents("12.5")).toBe(1250);
  });
  it("refuses anything that is not a positive amount", () => {
    for (const bad of ["", "0", "-5", "12.345", "abc", "1e3"]) expect(dollarsToCents(bad)).toBeNull();
  });
});

describe("evidencePath", () => {
  it("puts the photo under facility and payment", () => {
    expect(evidencePath("f", "p", "IMG_2210.HEIC")).toBe("f/p/check.heic");
    expect(evidencePath("f", "p", "noext")).toBe("f/p/check");
  });
});

function client(rpcResult: { data: unknown; error: unknown }, uploadError: unknown = null) {
  const upload = vi.fn().mockResolvedValue({ error: uploadError });
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { client: { storage: { from: vi.fn(() => ({ upload })) }, rpc } as never, upload, rpc };
}

const input = {
  paymentId: "p-1", facilityId: "f-1", residentId: "r-1", paymentDate: "2026-09-22", amountCents: 240000,
  method: "check" as const, reference: " 1042 ", payerName: "", mismatchReason: "", note: "",
  photo: new File(["x"], "check.jpg", { type: "image/jpeg" }),
};

describe("recordPaymentOnHome", () => {
  it("uploads the photo, then records through home_record_payment", async () => {
    const { client: c, upload, rpc } = client({ data: { allocated_cents: 240000, unapplied_cents: 0, replayed: false }, error: null });
    const out = await recordPaymentOnHome(c, input);
    expect(upload).toHaveBeenCalledWith("f-1/p-1/check.jpg", input.photo, expect.objectContaining({ upsert: false }));
    expect(rpc).toHaveBeenCalledWith("home_record_payment", expect.objectContaining({ p_id: "p-1", p_evidence_path: "f-1/p-1/check.jpg", p_reference: "1042", p_payer_name: null }));
    expect(out).toEqual({ kind: "recorded", allocatedCents: 240000, unappliedCents: 0, replayed: false });
  });
  it("treats an existing photo as the retry it is", async () => {
    const { client: c, rpc } = client({ data: { allocated_cents: 1, unapplied_cents: 0 }, error: null }, { message: "The resource already exists" });
    expect((await recordPaymentOnHome(c, input)).kind).toBe("recorded");
    expect(rpc).toHaveBeenCalled();
  });
  it("asks for a reason when the amount is not the open balance", async () => {
    const { client: c } = client({ data: null, error: { message: "This is not the full amount due.", hint: "mismatch_reason_required" } });
    expect(await recordPaymentOnHome(c, input)).toEqual({ kind: "reason_required", message: "This is not the full amount due." });
  });
  it("stops before recording when the photo cannot be stored", async () => {
    const { client: c, rpc } = client({ data: null, error: null }, { message: "network" });
    expect((await recordPaymentOnHome(c, input)).kind).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });
});
