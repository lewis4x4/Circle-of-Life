import type { FamilyDeliveryMethod } from "@/lib/admin/family-messages-data";

export type FamilyBulletinDraft = {
  body: string;
  deliveryMethod: FamilyDeliveryMethod;
};

export type FamilyBulletinDraftStore = Readonly<Record<string, FamilyBulletinDraft>>;

export type BulletinPostClaim = {
  generation: number;
  residentId: string;
  facilityId: string;
  body: string;
};

export function emptyFamilyBulletinDraft(): FamilyBulletinDraft {
  return { body: "", deliveryMethod: "portal_only" };
}

export function draftForResident(
  store: FamilyBulletinDraftStore,
  residentId: string,
): FamilyBulletinDraft {
  if (!residentId) return emptyFamilyBulletinDraft();
  return store[residentId] ?? emptyFamilyBulletinDraft();
}

export function writeResidentDraft(
  store: FamilyBulletinDraftStore,
  residentId: string,
  draft: FamilyBulletinDraft,
): FamilyBulletinDraftStore {
  if (!residentId) return store;
  return {
    ...store,
    [residentId]: {
      body: draft.body,
      deliveryMethod: draft.deliveryMethod,
    },
  };
}

/** Drop a draft only when the posted text is still the text stored for that resident. */
export function clearPostedResidentDraft(
  store: FamilyBulletinDraftStore,
  residentId: string,
  postedBody: string,
): FamilyBulletinDraftStore {
  const current = store[residentId];
  if (!current || current.body !== postedBody) return store;
  const next = { ...store };
  delete next[residentId];
  return next;
}

export function claimBulletinPost(
  inFlight: BulletinPostClaim | null,
  next: BulletinPostClaim,
):
  | { ok: true; claim: BulletinPostClaim }
  | { ok: false; reason: "missing_resident" | "empty_body" | "in_flight" } {
  if (!next.residentId) return { ok: false, reason: "missing_resident" };
  if (!next.body.trim()) return { ok: false, reason: "empty_body" };
  if (inFlight) return { ok: false, reason: "in_flight" };
  return { ok: true, claim: next };
}

export function isCurrentAsyncGeneration(
  responseGeneration: number,
  currentGeneration: number,
): boolean {
  return responseGeneration === currentGeneration;
}
