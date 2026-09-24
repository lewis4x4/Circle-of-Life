// @vitest-environment node
import { describe, expect, it } from "vitest";
import { payrollBody } from "./http";
import { createPacketSchema, packetActionSchema, payrollPolicySchema } from "./validation";

describe("payroll mutation boundary", () => {
  it("accepts the deployed Host when the runtime URL is internal", async () => {
    const request = new Request("https://internal.netlify/functions", { method: "POST", headers: { host: "circleoflifealf.com", origin: "https://circleoflifealf.com", "Content-Type": "application/json" }, body: "{}" });
    expect(await payrollBody(request)).toEqual({});
  });
  it("refuses cross-site origins and text/plain requests", async () => {
    await expect(payrollBody(new Request("https://circleoflifealf.com/api", { method: "POST", headers: { origin: "https://other.example", "Content-Type": "application/json" }, body: "{}" }))).rejects.toMatchObject({ status: 403 });
    await expect(payrollBody(new Request("https://circleoflifealf.com/api", { method: "POST", body: "{}" }))).rejects.toMatchObject({ status: 415 });
  });
  it("rejects impossible dates and a check date before period end", () => {
    expect(createPacketSchema.safeParse({ facilityId: "11111111-1111-4111-8111-111111111111", periodStart: "2026-02-30", periodEnd: "2026-03-06", checkDate: "2026-03-07" }).success).toBe(false);
    expect(createPacketSchema.safeParse({ facilityId: "11111111-1111-4111-8111-111111111111", periodStart: "2026-09-14", periodEnd: "2026-09-20", checkDate: "2026-09-15" }).success).toBe(false);
  });
  it("does not permit caller-supplied actors or a false reconciliation", () => {
    expect(packetActionSchema.safeParse({ action: "approve", expectedRevision: 1, actor_id: "someone" }).success).toBe(false);
    expect(packetActionSchema.safeParse({ action: "reconcile", expectedRevision: 1, matches: false, note: "Mismatch" }).success).toBe(false);
    expect(payrollPolicySchema.safeParse({}).success).toBe(false);
  });
});
