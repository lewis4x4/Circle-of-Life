import {
  canUseCurrentActorFacilityScope,
  CurrentActorError,
  currentActorOrProviderErrorResponse,
  filterRowsToCurrentActorFacilities,
  requireCurrentActor,
  withCurrentActorRevalidation,
} from "./current-actor.ts";

const ACTOR = {
  user_id: "00000000-0000-0000-0000-000000000101",
  session_id: "00000000-0000-0000-0000-000000000102",
  email: "actor@example.test",
  organization_id: "00000000-0000-0000-0000-000000000201",
  app_role: "facility_admin",
  auth_claim_version: 4,
  accessible_facility_ids: ["00000000-0000-0000-0000-000000000301"],
};

function request(authorization?: string) {
  return new Request("https://example.test/functions/v1/test", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

function rpcClient(results: unknown[]) {
  let index = 0;
  return {
    rpc: (_name: string) =>
      Promise.resolve({ data: results[index++] ?? null, error: null }),
  };
}

Deno.test("current actor rejects missing and malformed bearer tokens before client construction", async () => {
  for (const req of [request(), request("Basic abc"), request("Bearer a b")]) {
    let constructed = false;
    try {
      await requireCurrentActor(req, {
        createUserClient: () => {
          constructed = true;
          return rpcClient([ACTOR]) as never;
        },
      });
      throw new Error("expected authorization failure");
    } catch (error) {
      if (!(error instanceof CurrentActorError) || error.status !== 401) {
        throw error;
      }
    }
    if (constructed) {
      throw new Error("user client was constructed for invalid auth");
    }
  }
});

Deno.test("current actor rejects inactive, deleted, stale-version, and revoked-session results", async () => {
  for (const result of [null, [], { error: "not an actor" }]) {
    try {
      await requireCurrentActor(request("Bearer valid"), {
        createUserClient: () => rpcClient([result]) as never,
      });
      throw new Error("expected authorization failure");
    } catch (error) {
      if (!(error instanceof CurrentActorError) || error.status !== 401) {
        throw error;
      }
    }
  }
});

Deno.test("current actor uses the live database role rather than request or token metadata", async () => {
  try {
    await requireCurrentActor(request("Bearer valid"), {
      allowedRoles: ["owner", "org_admin"],
      createUserClient: () => rpcClient([ACTOR]) as never,
    });
    throw new Error("expected role denial");
  } catch (error) {
    if (!(error instanceof CurrentActorError) || error.status !== 403) {
      throw error;
    }
  }
});

Deno.test("revalidation blocks role, organization, and facility authority changes", async () => {
  for (
    const changed of [
      { ...ACTOR, app_role: "caregiver" },
      { ...ACTOR, organization_id: "00000000-0000-0000-0000-000000000999" },
      { ...ACTOR, accessible_facility_ids: [] },
    ]
  ) {
    const authorization = await requireCurrentActor(request("Bearer valid"), {
      createUserClient: () => rpcClient([ACTOR, changed]) as never,
    });
    try {
      await authorization.revalidate(ACTOR.accessible_facility_ids[0]);
      throw new Error("expected revalidation denial");
    } catch (error) {
      if (!(error instanceof CurrentActorError) || error.status !== 403) {
        throw error;
      }
    }
  }
});

Deno.test("provider operation is not called when current authority is revoked", async () => {
  const authorization = await requireCurrentActor(request("Bearer valid"), {
    createUserClient: () => rpcClient([ACTOR, null]) as never,
  });
  let providerCalled = false;
  try {
    await withCurrentActorRevalidation(authorization, async () => {
      providerCalled = true;
      return new Response();
    });
    throw new Error("expected provider denial");
  } catch (error) {
    if (!(error instanceof CurrentActorError)) throw error;
  }
  if (providerCalled) throw new Error("provider was called after revocation");
});

Deno.test("a valid live actor can revalidate and run the guarded operation", async () => {
  const authorization = await requireCurrentActor(request("Bearer valid"), {
    createUserClient: () => rpcClient([ACTOR, ACTOR]) as never,
  });
  const result = await withCurrentActorRevalidation(
    authorization,
    async () => "ok",
    ACTOR.accessible_facility_ids[0],
  );
  if (result !== "ok") throw new Error("guarded operation did not run");
});

Deno.test("mixed-facility rows retain only current organization and live facility scope", () => {
  const actor = {
    userId: ACTOR.user_id,
    sessionId: ACTOR.session_id,
    email: ACTOR.email,
    organizationId: ACTOR.organization_id,
    role: ACTOR.app_role,
    claimVersion: ACTOR.auth_claim_version,
    accessibleFacilityIds: ACTOR.accessible_facility_ids,
  };
  const visible = filterRowsToCurrentActorFacilities(actor, [
    {
      id: "visible",
      organization_id: ACTOR.organization_id,
      facility_id: ACTOR.accessible_facility_ids[0],
    },
    {
      id: "revoked",
      organization_id: ACTOR.organization_id,
      facility_id: "00000000-0000-0000-0000-000000000399",
    },
    {
      id: "foreign",
      organization_id: "00000000-0000-0000-0000-000000000299",
      facility_id: ACTOR.accessible_facility_ids[0],
    },
    {
      id: "unscoped",
      organization_id: ACTOR.organization_id,
      facility_id: null,
    },
  ]);
  if (visible.length !== 1 || visible[0]?.id !== "visible") {
    throw new Error("mixed-facility scope leaked a row");
  }
  const ownerVisible = filterRowsToCurrentActorFacilities(
    { ...actor, role: "owner" },
    [
      {
        id: "facility",
        organization_id: ACTOR.organization_id,
        facility_id: ACTOR.accessible_facility_ids[0],
      },
      {
        id: "org-wide",
        organization_id: ACTOR.organization_id,
        facility_id: null,
      },
    ],
    { includeOrganizationWide: true },
  );
  if (ownerVisible.map((row) => row.id).join(",") !== "facility,org-wide") {
    throw new Error("owner lost organization-wide facts");
  }
  if (
    canUseCurrentActorFacilityScope(actor, null, {
      allowOrganizationWide: true,
    }) ||
    !canUseCurrentActorFacilityScope({ ...actor, role: "owner" }, null, {
      allowOrganizationWide: true,
    })
  ) {
    throw new Error("null facility scope did not remain owner/org-admin only");
  }
});

Deno.test("provider failures stay sanitized and are never misreported as auth failures", async () => {
  const provider = currentActorOrProviderErrorResponse(
    new Error("secret upstream body"),
    {
      status: 504,
      message: "Provider timed out",
    },
  );
  if (
    provider.status !== 504 ||
    (await provider.text()) !== '{"error":"Provider timed out"}'
  ) {
    throw new Error("provider error was not sanitized");
  }
  const denied = currentActorOrProviderErrorResponse(
    new CurrentActorError(403, "Forbidden"),
    { status: 502, message: "Provider failed" },
  );
  if (denied.status !== 403 || !(await denied.text()).includes("Forbidden")) {
    throw new Error("authorization error lost its status");
  }
});

Deno.test("revocation during audit and session persistence cannot produce a success response", async () => {
  const authorization = await requireCurrentActor(request("Bearer valid"), {
    createUserClient: () => rpcClient([ACTOR, ACTOR, null]) as never,
  });
  let auditPersisted = false;
  let sessionPersisted = false;
  let successResponseCreated = false;
  await withCurrentActorRevalidation(authorization, async () => {
    auditPersisted = true;
  });
  try {
    await withCurrentActorRevalidation(authorization, async () => {
      sessionPersisted = true;
    });
    await withCurrentActorRevalidation(authorization, async () => {
      successResponseCreated = true;
    });
    throw new Error("expected persistence authorization denial");
  } catch (error) {
    if (!(error instanceof CurrentActorError)) throw error;
  }
  if (!auditPersisted || sessionPersisted || successResponseCreated) {
    throw new Error("revoked persistence sequence continued to success");
  }
});
