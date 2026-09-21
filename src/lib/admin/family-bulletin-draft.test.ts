import { describe, expect, it } from "vitest";

import {
  claimBulletinPost,
  clearPostedResidentDraft,
  draftForResident,
  isCurrentAsyncGeneration,
  writeResidentDraft,
  type FamilyBulletinDraftStore,
} from "./family-bulletin-draft";

const RESIDENT_A = "22222222-2222-4222-8222-222222222222";
const RESIDENT_B = "33333333-3333-4333-8333-333333333333";
const FACILITY = "11111111-1111-4111-8111-111111111111";

describe("family bulletin drafts", () => {
  it("restores resident A's draft after switching to B and back, and starts B empty", () => {
    let store: FamilyBulletinDraftStore = {};
    store = writeResidentDraft(store, RESIDENT_A, {
      body: "Ada ate lunch.",
      deliveryMethod: "portal_only",
    });

    expect(draftForResident(store, RESIDENT_B)).toEqual({
      body: "",
      deliveryMethod: "portal_only",
    });

    store = writeResidentDraft(store, RESIDENT_B, {
      body: "Bea had a visitor.",
      deliveryMethod: "portal_and_email",
    });

    expect(draftForResident(store, RESIDENT_A)).toEqual({
      body: "Ada ate lunch.",
      deliveryMethod: "portal_only",
    });
    expect(draftForResident(store, RESIDENT_B).body).toBe("Bea had a visitor.");
    expect(draftForResident(store, "").body).toBe("");
  });

  it("refuses a second post while one is in flight and ignores a stale posted body", () => {
    let store = writeResidentDraft({}, RESIDENT_A, {
      body: "Ada ate lunch.",
      deliveryMethod: "portal_only",
    });
    store = writeResidentDraft(store, RESIDENT_B, {
      body: "Bea had a visitor.",
      deliveryMethod: "portal_only",
    });

    const first = claimBulletinPost(null, {
      generation: 1,
      residentId: RESIDENT_A,
      facilityId: FACILITY,
      body: "Ada ate lunch.",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const concurrent = claimBulletinPost(first.claim, {
      generation: 2,
      residentId: RESIDENT_B,
      facilityId: FACILITY,
      body: "Bea had a visitor.",
    });
    expect(concurrent).toEqual({ ok: false, reason: "in_flight" });

    store = writeResidentDraft(store, RESIDENT_A, {
      body: "Ada ate lunch and rested.",
      deliveryMethod: "portal_only",
    });
    store = clearPostedResidentDraft(store, RESIDENT_A, "Ada ate lunch.");
    expect(draftForResident(store, RESIDENT_A).body).toBe("Ada ate lunch and rested.");
    expect(draftForResident(store, RESIDENT_B).body).toBe("Bea had a visitor.");

    store = clearPostedResidentDraft(store, RESIDENT_A, "Ada ate lunch and rested.");
    expect(draftForResident(store, RESIDENT_A).body).toBe("");
    expect(draftForResident(store, RESIDENT_B).body).toBe("Bea had a visitor.");
  });

  it("treats an older async generation as stale", () => {
    expect(isCurrentAsyncGeneration(1, 2)).toBe(false);
    expect(isCurrentAsyncGeneration(4, 4)).toBe(true);
  });

  it("does not claim a post without a resident or text", () => {
    expect(
      claimBulletinPost(null, {
        generation: 1,
        residentId: "",
        facilityId: FACILITY,
        body: "Hello",
      }).ok,
    ).toBe(false);
    expect(
      claimBulletinPost(null, {
        generation: 1,
        residentId: RESIDENT_A,
        facilityId: FACILITY,
        body: "   ",
      }).ok,
    ).toBe(false);
  });
});
