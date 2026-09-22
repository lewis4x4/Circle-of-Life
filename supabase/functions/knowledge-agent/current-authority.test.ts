import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CurrentActorError } from "../_shared/current-actor.ts";
import {
  answerReferralPipelineQuestion,
  canReadReferralPipeline,
  emitAuthorizedKnowledgeResult,
} from "./index.ts";

Deno.test("referral pipeline roles match the database capability map", () => {
  for (const role of [
    "owner",
    "org_admin",
    "facility_admin",
    "manager",
    "admin_assistant",
    "coordinator",
    "med_tech",
    "marketing",
  ]) {
    assertEquals(canReadReferralPipeline(role), true, role);
  }
  for (const role of ["cook", "caregiver", "dietary", "housekeeper", "maintenance_role", "family", "broker"]) {
    assertEquals(canReadReferralPipeline(role), false, role);
  }
});

Deno.test("wrong-role referral route returns no service-role rows", async () => {
  let queried = false;
  const result = await answerReferralPipelineQuestion(
    {
      admin: {
        from: () => {
          queried = true;
          throw new Error("service-role query must not run");
        },
      },
      workspaceId: "00000000-0000-0000-0000-000000000101",
      userRole: "housekeeper",
      userId: "00000000-0000-0000-0000-000000000201",
      userEmail: null,
      accessibleFacilityIds: ["00000000-0000-0000-0000-000000000301"],
      revalidate: () => Promise.resolve(),
    } as never,
    "show the referral pipeline",
    {
      facilityIds: ["00000000-0000-0000-0000-000000000301"],
      facilityNames: ["Test facility"],
    },
  );
  assertEquals(queried, false);
  assertEquals(result.provenance.fallback_reason, "access_restricted");
  assertEquals(result.provenance.tables_queried, []);
  assertEquals(result.provenance.rows_examined, 0);
});

Deno.test("referral route labels capped status evidence and uses an exact total", async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `lead-${index}`,
    facility_id: "00000000-0000-0000-0000-000000000301",
    first_name: "Test",
    last_name: `Lead ${index}`,
    preferred_name: null,
    status: index === 0 ? "converted" : "new",
    created_at: "2026-09-14T12:00:00Z",
    updated_at: "2026-09-14T12:00:00Z",
    referral_sources: null,
  }));
  let selectOptions: unknown;
  const builder = {
    select: (_columns: string, options: unknown) => {
      selectOptions = options;
      return builder;
    },
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null, count: 40 }),
  };
  let revalidations = 0;
  const result = await answerReferralPipelineQuestion(
    {
      admin: { from: () => builder },
      workspaceId: "00000000-0000-0000-0000-000000000101",
      userRole: "med_tech",
      userId: "00000000-0000-0000-0000-000000000201",
      userEmail: null,
      accessibleFacilityIds: ["00000000-0000-0000-0000-000000000301"],
      revalidate: () => {
        revalidations += 1;
        return Promise.resolve();
      },
    } as never,
    "show referrals today",
    {
      facilityIds: ["00000000-0000-0000-0000-000000000301"],
      facilityNames: ["Test facility"],
    },
  );
  assertEquals(selectOptions, { count: "exact" });
  assertEquals(revalidations, 2);
  assertEquals(result.text.includes("40 leads created"), true);
  assertEquals(result.text.includes("Status sample for the 25 most recent leads"), true);
  assertEquals(result.provenance.rows_examined, 25);
});

Deno.test("referral route fails closed when the service query fails", async () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: null, error: { message: "secret" }, count: null }),
  };
  await assertRejects(
    () => answerReferralPipelineQuestion(
      {
        admin: { from: () => builder },
        workspaceId: "00000000-0000-0000-0000-000000000101",
        userRole: "med_tech",
        userId: "00000000-0000-0000-0000-000000000201",
        userEmail: null,
        accessibleFacilityIds: ["00000000-0000-0000-0000-000000000301"],
        revalidate: () => Promise.resolve(),
      } as never,
      "show referrals today",
      {
        facilityIds: ["00000000-0000-0000-0000-000000000301"],
        facilityNames: ["Test facility"],
      },
    ),
    Error,
    "Referral pipeline query failed",
  );
});

Deno.test("referral route fails closed when an exact count is unavailable", async () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({
      data: [{
        id: "lead-1",
        facility_id: "00000000-0000-0000-0000-000000000301",
        first_name: "Test",
        last_name: "Lead",
        preferred_name: null,
        status: "new",
        created_at: "2026-09-14T12:00:00Z",
        updated_at: "2026-09-14T12:00:00Z",
        referral_sources: null,
      }],
      error: null,
      count: null,
    }),
  };
  await assertRejects(
    () => answerReferralPipelineQuestion(
      {
        admin: { from: () => builder },
        workspaceId: "00000000-0000-0000-0000-000000000101",
        userRole: "med_tech",
        userId: "00000000-0000-0000-0000-000000000201",
        userEmail: null,
        accessibleFacilityIds: ["00000000-0000-0000-0000-000000000301"],
        revalidate: () => Promise.resolve(),
      } as never,
      "show referrals today",
      {
        facilityIds: ["00000000-0000-0000-0000-000000000301"],
        facilityNames: ["Test facility"],
      },
    ),
    Error,
    "Referral pipeline query failed",
  );
});

Deno.test("mid-loop revocation emits zero answer and source chunks", async () => {
  const chunks: Uint8Array[] = [];
  await assertRejects(
    () =>
      emitAuthorizedKnowledgeResult({
        controller: {
          enqueue: (chunk) => {
            if (chunk) chunks.push(chunk);
          },
        },
        encoder: new TextEncoder(),
        revalidate: () =>
          Promise.reject(new CurrentActorError(403, "Forbidden")),
        result: {
          text: "secret resident answer",
          sources: [{
            title: "secret source",
            excerpt: "secret excerpt",
            confidence: 1,
            section_title: null,
            anchor: {
              document_id: "00000000-0000-0000-0000-000000000401",
              chunk_id: "00000000-0000-0000-0000-000000000402",
            },
          }],
          toolsUsed: ["semantic_kb_search"],
          tokensIn: 10,
          tokensOut: 20,
          model: "test-model",
          kbSearchMiss: false,
          deterministic: false,
          clarification_needed: null,
        } as never,
        traceId: "trace-secret",
        conversationId: "conversation-secret",
        kbEmpty: false,
      }),
    CurrentActorError,
  );
  assertEquals(chunks.length, 0);
});
