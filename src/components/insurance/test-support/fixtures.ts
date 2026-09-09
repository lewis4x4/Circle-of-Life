import {
  createEmptyPolicyDraft,
  type InsuranceWorkspace,
  type InsuranceDraft,
  type InsuranceDocument,
} from "@/lib/insurance/workspace-types";
export const entityId = "11111111-1111-4111-8111-111111111111";
export const facilityId = "22222222-2222-4222-8222-222222222222";
export const documentId = "33333333-3333-4333-8333-333333333333";
export const policyId = "44444444-4444-4444-8444-444444444444";
export const draftId = "55555555-5555-4555-8555-555555555555";
export function workspaceFixture(): InsuranceWorkspace {
  return {
    can_manage: true,
    owners: [{ id: entityId, name: "Insurance owner" }],
    entities: [{ id: entityId, name: "Example ALF LLC" }],
    facilities: [{ id: facilityId, name: "Example ALF", entity_id: entityId }],
    policies: [],
    documents: [],
    drafts: [],
    work_items: [],
    certificate_requests: [],
    versions: [],
  };
}
export function documentFixture(): InsuranceDocument {
  return {
    id: documentId,
    organization_id: entityId,
    filename: "Example policy.pdf",
    family: "policy",
    mime_type: "application/pdf",
    byte_size: 100,
    sha256: "abc",
    storage_path: "private/source.pdf",
    facility_id: null,
    status: "ready",
    scan_status: "not_configured",
    extraction_status: "manual_review",
    error: null,
    run_id: null,
    created_at: "2026-09-08T12:00:00Z",
  };
}
export function draftFixture(): InsuranceDraft {
  const payload = {
    ...createEmptyPolicyDraft(),
    entity_id: entityId,
    carrier_name: "Example carrier",
    policy_number: "GL-123",
    effective_date: "2026-09-01",
    expiration_date: "2027-09-01",
    shared_limit: true,
    parties: [
      {
        entity_id: entityId,
        role: "primary_named_insured",
        effective_from: "2026-09-01",
        effective_to: null,
      },
    ],
    facilities: [
      {
        facility_id: facilityId,
        role: "scheduled_location",
        effective_from: "2026-09-01",
        effective_to: null,
      },
    ],
  };
  return {
    id: draftId,
    document_id: documentId,
    kind: "new_policy",
    policy_id: null,
    expected_version: null,
    revision: 2,
    status: "draft",
    payload,
    evidence: Object.fromEntries(
      [
        "entity_id",
        "policy_type",
        "carrier_name",
        "policy_number",
        "effective_date",
        "expiration_date",
        "shared_limit",
        "parties.0",
        "facilities.0",
      ].map((k) => [
        k,
        {
          source: "manual" as const,
          reason:
            "Confirmed against signed declarations by authorized reviewer.",
        },
      ]),
    ),
    created_at: "2026-09-08T12:00:00Z",
  };
}
