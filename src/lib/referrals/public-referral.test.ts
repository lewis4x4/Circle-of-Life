import { afterEach, expect, it, vi } from "vitest";
import { publicReferralSchema, submitPublicReferral, PUBLIC_TOUR_TIMES } from "./public-referral";

const inquiry = { kind: "inquiry" as const, requestKey: "11111111-1111-4111-8111-111111111111", facility: "homewood" as const, name: "Test Family", phone: "3865550199", email: "test@example.invalid", message: "Please call." };
afterEach(() => vi.unstubAllGlobals());
it.each(["2026-02-30", "2026-13-01", "2026-1-01", "not-a-date"])("rejects invalid tour date %s", (tourDate) => {
  const common = { requestKey: inquiry.requestKey, facility: inquiry.facility, name: inquiry.name, phone: inquiry.phone, email: inquiry.email };
  expect(publicReferralSchema.safeParse({ ...common, kind: "tour", tourDate, tourTime: PUBLIC_TOUR_TIMES[1], lunchOption: "yes-2" }).success).toBe(false);
});
it.each([[400, "Check your name"], [403, "call the community directly"], [409, "confirm receipt before sending"], [429, "wait ten minutes"], [503, "could not confirm receipt"]])("explains server failure %s without claiming receipt", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
  await expect(submitPublicReferral(inquiry)).rejects.toThrow(message as string);
});
it("does not treat a successful HTTP response without durable receipt as success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  await expect(submitPublicReferral(inquiry)).rejects.toThrow("could not confirm receipt");
});
