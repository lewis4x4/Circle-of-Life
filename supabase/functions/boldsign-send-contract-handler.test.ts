import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const IDS = {
  actor: "00000000-0000-0000-0000-000000000101",
  session: "00000000-0000-0000-0000-000000000102",
  organization: "00000000-0000-0000-0000-000000000201",
  otherOrganization: "00000000-0000-0000-0000-000000000202",
  facility: "00000000-0000-0000-0000-000000000301",
  otherFacility: "00000000-0000-0000-0000-000000000302",
  contract: "00000000-0000-0000-0000-000000000401",
  resident: "00000000-0000-0000-0000-000000000402",
  signer: "00000000-0000-0000-0000-000000000403",
} as const;

for (
  const [name, value] of Object.entries({
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    BOLDSIGN_API_BASE_URL: "https://boldsign.test",
    BOLDSIGN_API_KEY: "test-provider-key",
    BOLDSIGN_DEFAULT_TEMPLATE_ID: "test-template",
  })
) {
  Deno.env.set(name, value);
}

const { handleBoldSignSend } = await import("./boldsign-send-contract/index.ts");

type ActorPayload = {
  user_id: string;
  session_id: string;
  email: string | null;
  organization_id: string;
  app_role: string;
  auth_claim_version: number;
  accessible_facility_ids: string[];
};

type RequestDoubleOptions = {
  actorAt: (rpcCall: number) => ActorPayload | null;
  contractOrganization?: string;
  contractFacility?: string;
  failCommit?: boolean;
  failFailureRecording?: boolean;
  onLinkRequest?: () => void;
  linkResponse?: () => Response;
  providerSend?: () => Response | Promise<Response>;
  signerCount?: number;
};

function actor(
  role = "med_tech",
  accessibleFacilityIds: string[] = [IDS.facility],
): ActorPayload {
  return {
    user_id: IDS.actor,
    session_id: IDS.session,
    email: "actor@example.test",
    organization_id: IDS.organization,
    app_role: role,
    auth_claim_version: 7,
    accessible_facility_ids: accessibleFacilityIds,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET"))
    .toUpperCase();
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function installRequestDouble(options: RequestDoubleOptions) {
  const originalFetch = globalThis.fetch;
  const providerCalls: string[] = [];
  const providerBodies: Record<string, unknown>[] = [];
  const databaseMutations: string[] = [];
  let actorRpcCalls = 0;
  let generation = 0;
  let sendState: "new" | "provider_outcome_unknown" | "rejected_definitively" | "committed" = "new";
  let currentRequestId: string | null = null;
  let providerDocumentId: string | null = null;
  const recoveryLabel = "haven-0123456789abcdef0123456789abcdef";
  const requestSha256 = "a".repeat(64);
  const providerPayload = {
    title: "Synthetic residency agreement",
    message: "Please review and sign this Circle of Life resident agreement.",
    roles: Array.from({ length: options.signerCount ?? 1 }, (_, index) => ({
      roleIndex: index + 1,
      signerName: "Synthetic signer",
      signerEmail: index === 0 ? "signer@example.test" : `signer-${index + 1}@example.test`,
      signerOrder: index + 1,
      signerType: "Signer",
      signerRole: "resident_representative",
      locale: "EN",
    })),
    enableSigningOrder: (options.signerCount ?? 1) > 1,
    disableEmails: true,
    labels: [recoveryLabel],
  };
  const linkSigners = Array.from({ length: options.signerCount ?? 1 }, (_, index) => ({
    id: index === 0 ? IDS.signer : `${IDS.signer}-${index}`,
    email: index === 0 ? "signer@example.test" : `signer-${index + 1}@example.test`,
  }));

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = methodOf(input, init);

    if (url.host === "supabase.test") {
      if (url.pathname === "/rest/v1/rpc/haven_current_edge_actor") {
        actorRpcCalls += 1;
        return json(options.actorAt(actorRpcCalls));
      }

      if (url.pathname === "/rest/v1/rpc/prepare_boldsign_contract_send") {
        databaseMutations.push(`POST ${url.pathname}`);
        const raw = input instanceof Request
          ? await input.clone().text()
          : String((init as { body?: unknown } | undefined)?.body ?? "{}");
        const args = JSON.parse(raw) as { p_request_id?: string };
        const requestedId = args.p_request_id ?? IDS.contract;
        if (currentRequestId && requestedId !== currentRequestId) {
          if (sendState !== "rejected_definitively") {
            return json({ code: "P0409", message: "contract_send_already_claimed" }, 409);
          }
          currentRequestId = requestedId;
          generation += 1;
          sendState = "provider_outcome_unknown";
          return json({
            action: "send",
            state: sendState,
            generation,
            request_sha256: requestSha256,
            provider_document_id: null,
            recovery_label: recoveryLabel,
            provider_payload: providerPayload,
            link_signers: linkSigners,
          });
        }
        if (sendState === "committed") {
          return json({
            action: "replay",
            state: "committed",
            generation,
            request_sha256: requestSha256,
            provider_document_id: providerDocumentId,
            recovery_label: recoveryLabel,
            provider_payload: providerPayload,
            link_signers: linkSigners,
          });
        }
        if (sendState === "provider_outcome_unknown") {
          return json({
            action: "reconcile",
            state: sendState,
            generation,
            request_sha256: requestSha256,
            provider_document_id: providerDocumentId,
            recovery_label: recoveryLabel,
            provider_payload: providerPayload,
            link_signers: linkSigners,
          });
        }
        if (sendState === "rejected_definitively") {
          return json({
            action: "rejected",
            state: sendState,
            generation,
            request_sha256: requestSha256,
            provider_document_id: null,
            recovery_label: recoveryLabel,
            provider_payload: providerPayload,
            link_signers: linkSigners,
          });
        }
        generation += 1;
        currentRequestId = requestedId;
        sendState = "provider_outcome_unknown";
        return json({
          action: "send",
          state: sendState,
          generation,
          request_sha256: requestSha256,
          provider_document_id: null,
          recovery_label: recoveryLabel,
          provider_payload: providerPayload,
          link_signers: linkSigners,
        });
      }

      if (url.pathname === "/rest/v1/rpc/commit_boldsign_contract_send") {
        databaseMutations.push(`POST ${url.pathname}`);
        if (options.failCommit) {
          return json({ code: "P0001", message: "synthetic commit rollback" }, 500);
        }
        const raw = input instanceof Request
          ? await input.clone().text()
          : String((init as { body?: unknown } | undefined)?.body ?? "{}");
        const args = JSON.parse(raw) as { p_provider_document_id?: string };
        providerDocumentId = args.p_provider_document_id ?? null;
        sendState = "committed";
        return json({
          action: "committed",
          state: "committed",
          generation,
          request_sha256: requestSha256,
          provider_document_id: providerDocumentId,
          recovery_label: recoveryLabel,
          provider_payload: providerPayload,
          link_signers: linkSigners,
        });
      }

      if (url.pathname === "/rest/v1/rpc/fail_boldsign_contract_send") {
        databaseMutations.push(`POST ${url.pathname}`);
        if (options.failFailureRecording) {
          return json({ code: "P0001", message: "synthetic failure receipt rollback" }, 500);
        }
        const raw = input instanceof Request
          ? await input.clone().text()
          : String((init as { body?: unknown } | undefined)?.body ?? "{}");
        const args = JSON.parse(raw) as { p_definite?: boolean };
        sendState = args.p_definite ? "rejected_definitively" : "provider_outcome_unknown";
        return json({
          action: "failed",
          state: sendState,
          generation,
          request_sha256: requestSha256,
        });
      }

      if (url.pathname === "/rest/v1/resident_contracts" && method === "GET") {
        return json({
          id: IDS.contract,
          organization_id: options.contractOrganization ?? IDS.organization,
          facility_id: options.contractFacility ?? IDS.facility,
          resident_id: IDS.resident,
          contract_type: "residency_agreement",
          title: "Synthetic residency agreement",
          provider: "boldsign",
          provider_template_id: "test-template",
          provider_document_id: null,
          status: "draft",
          metadata: null,
        });
      }

      if (
        url.pathname === "/rest/v1/resident_contract_signers" &&
        method === "GET"
      ) {
        return json(Array.from({ length: options.signerCount ?? 1 }, (_, index) => ({
          id: index === 0 ? IDS.signer : `${IDS.signer}-${index}`,
          signer_name: "Synthetic signer",
          signer_email: "signer@example.test",
          signer_role: "resident_representative",
          routing_order: index + 1,
        })));
      }

      if (["POST", "PATCH"].includes(method)) {
        databaseMutations.push(`${method} ${url.pathname}`);
        return json([]);
      }

      throw new Error(`Unhandled Supabase request: ${method} ${url}`);
    }

    if (url.host === "boldsign.test") {
      if (url.pathname === "/v1/template/send") {
        providerCalls.push("send");
        providerBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return options.providerSend?.() ?? json({ documentId: "synthetic-document" });
      }
      if (url.pathname === "/v1/document/getEmbeddedSignLink") {
        providerCalls.push("link");
        options.onLinkRequest?.();
        return options.linkResponse?.() ?? json({ signLink: "https://sign.test/synthetic-link" });
      }
      throw new Error(`Unhandled BoldSign request: ${method} ${url}`);
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  return {
    providerCalls,
    providerBodies,
    databaseMutations,
    actorRpcCalls: () => actorRpcCalls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function signingRequest(idempotencyKey?: string): Request {
  return new Request("https://edge.test/functions/v1/boldsign-send-contract", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contract_id: IDS.contract,
      disable_emails: true,
      get_embedded_links: true,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    }),
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert(body !== null && typeof body === "object" && !Array.isArray(body));
  return body as Record<string, unknown>;
}

async function assertDeniedWithoutSigningData(
  response: Response,
  expectedError: "Unauthorized" | "Forbidden",
  message?: string,
): Promise<void> {
  assertEquals(await bodyOf(response), { error: expectedError }, message);
}

function actualHandlerTest(
  name: string,
  fn: () => void | Promise<void>,
): void {
  // The production Supabase service client owns a background auth interval.
  // These tests replace all transport and restore fetch, but the imported SDK
  // interval outlives one request by design.
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });
}

actualHandlerTest("actual signing handler rejects missing, malformed, and disallowed current actors before provider work", async () => {
  for (
    const [label, actorResult, expectedStatus] of [
      ["missing", null, 401],
      ["malformed", { error: "not an actor" }, 401],
      ["disallowed role", actor("caregiver"), 403],
    ] as const
  ) {
    const double = installRequestDouble({
      actorAt: () => actorResult as ActorPayload | null,
    });
    try {
      const response = await handleBoldSignSend(signingRequest());
      assertEquals(response.status, expectedStatus, label);
      await assertDeniedWithoutSigningData(
        response,
        expectedStatus === 401 ? "Unauthorized" : "Forbidden",
        label,
      );
      assertEquals(double.providerCalls, [], label);
      assertEquals(double.databaseMutations, [], label);
    } finally {
      double.restore();
    }
  }
});

actualHandlerTest("actual signing handler denies cross-organization and disjoint-facility contracts without provider work or links", async () => {
  const scenarios = [
    {
      label: "cross-organization",
      actor: actor("facility_admin", [IDS.facility]),
      contractOrganization: IDS.otherOrganization,
      contractFacility: IDS.facility,
    },
    ...["facility_admin", "manager", "med_tech"].map((role) => ({
      label: `${role} disjoint facility`,
      actor: actor(role, [IDS.otherFacility]),
      contractOrganization: IDS.organization,
      contractFacility: IDS.facility,
    })),
  ];

  for (const scenario of scenarios) {
    const double = installRequestDouble({
      actorAt: () => scenario.actor,
      contractOrganization: scenario.contractOrganization,
      contractFacility: scenario.contractFacility,
    });
    try {
      const response = await handleBoldSignSend(signingRequest());
      assertEquals(response.status, 403, scenario.label);
      await assertDeniedWithoutSigningData(response, "Forbidden", scenario.label);
      assertEquals(double.providerCalls, [], scenario.label);
      assertEquals(double.databaseMutations, [], scenario.label);
      assertEquals(double.actorRpcCalls(), 1, scenario.label);
    } finally {
      double.restore();
    }
  }
});

actualHandlerTest("actual signing handler blocks provider send when facility access is revoked during pre-send revalidation", async () => {
  const double = installRequestDouble({
    actorAt: (rpcCall) => rpcCall === 1 ? actor() : actor("med_tech", []),
  });
  try {
    const response = await handleBoldSignSend(signingRequest());
    assertEquals(response.status, 403);
    await assertDeniedWithoutSigningData(response, "Forbidden");
    assertEquals(double.providerCalls, []);
    assertEquals(double.databaseMutations, []);
    assertEquals(double.actorRpcCalls(), 2);
  } finally {
    double.restore();
  }
});

actualHandlerTest("actual signing handler blocks embedded-link provider work when access is revoked before the link request", async () => {
  const double = installRequestDouble({
    actorAt: (rpcCall) => rpcCall < 4 ? actor() : actor("med_tech", []),
  });
  try {
    const response = await handleBoldSignSend(signingRequest());
    assertEquals(response.status, 403);
    await assertDeniedWithoutSigningData(response, "Forbidden");
    assertEquals(double.providerCalls, ["send"]);
    assertEquals(double.actorRpcCalls(), 4);
    assert(double.databaseMutations.length > 0);
  } finally {
    double.restore();
  }
});

actualHandlerTest("actual signing handler preserves an authorized multi-site med-tech send and embedded-link response", async () => {
  const allowed = actor("med_tech", [IDS.otherFacility, IDS.facility]);
  const double = installRequestDouble({ actorAt: () => allowed });
  try {
    const response = await handleBoldSignSend(signingRequest());
    const body = await bodyOf(response);
    assertEquals(response.status, 200);
    assertEquals(double.providerCalls, ["send", "link"]);
    assertEquals(body.document_id, "synthetic-document");
    assertEquals(body.embedded_links, {
      [IDS.signer]: "https://sign.test/synthetic-link",
    });
    assertEquals(double.providerBodies.length, 1);
    assertMatch(
      String((double.providerBodies[0].labels as string[])[0]),
      /^haven-[0-9a-f]{32}$/,
    );
    assert(double.databaseMutations.includes(
      "POST /rest/v1/rpc/prepare_boldsign_contract_send",
    ));
    assert(double.databaseMutations.includes(
      "POST /rest/v1/rpc/commit_boldsign_contract_send",
    ));
  } finally {
    double.restore();
  }
});

actualHandlerTest("actual signing handler denies links if access changes while the final provider request is in flight", async () => {
  let liveActor = actor();
  const double = installRequestDouble({
    actorAt: () => liveActor,
    onLinkRequest: () => {
      liveActor = actor("med_tech", []);
    },
  });
  try {
    const response = await handleBoldSignSend(signingRequest());
    assertEquals(response.status, 403);
    await assertDeniedWithoutSigningData(response, "Forbidden");
    assertEquals(double.providerCalls, ["send", "link"]);
    assertEquals(liveActor.accessible_facility_ids, []);
  } finally {
    double.restore();
  }
});

actualHandlerTest("actual signing handler denies accumulated links when authority changes during a later link response body", async () => {
  for (const revokedActor of [actor("med_tech", []), actor("caregiver"), null]) {
    let liveActor: ActorPayload | null = actor();
    let linkRequests = 0;
    const double = installRequestDouble({
      actorAt: () => liveActor,
      signerCount: 3,
      linkResponse: () => {
        linkRequests += 1;
        const response = json({ signLink: "https://sign.test/synthetic-link" });
        if (linkRequests === 2) {
          response.json = async () => {
            await Promise.resolve();
            liveActor = revokedActor;
            return { signLink: "https://sign.test/second-link" };
          };
        }
        return response;
      },
    });
    try {
      const response = await handleBoldSignSend(signingRequest());
      assertEquals(response.status, revokedActor ? 403 : 401);
      await assertDeniedWithoutSigningData(response, revokedActor ? "Forbidden" : "Unauthorized");
      assertEquals(double.providerCalls, ["send", "link", "link"]);
      assertEquals(double.databaseMutations, [
        "POST /rest/v1/rpc/prepare_boldsign_contract_send",
        "POST /rest/v1/rpc/commit_boldsign_contract_send",
      ]);
    } finally {
      double.restore();
    }
  }
});

actualHandlerTest("actual signing handler denies a failed final link response after facility revocation", async () => {
  let liveActor = actor();
  const double = installRequestDouble({
    actorAt: () => liveActor,
    onLinkRequest: () => { liveActor = actor("med_tech", []); },
    linkResponse: () => json({ error: "Provider failure" }, 502),
  });
  try {
    const response = await handleBoldSignSend(signingRequest());
    assertEquals(response.status, 403);
    await assertDeniedWithoutSigningData(response, "Forbidden");
    assertEquals(double.providerCalls, ["send", "link"]);
  } finally {
    double.restore();
  }
});

actualHandlerTest("actual signing handler rechecks authority before returning accumulated links", async () => {
  const double = installRequestDouble({
    actorAt: (rpcCall) => rpcCall < 6 ? actor() : actor("med_tech", []),
  });
  try {
    const response = await handleBoldSignSend(signingRequest());
    assertEquals(response.status, 403);
    await assertDeniedWithoutSigningData(response, "Forbidden");
    assertEquals(double.providerCalls, ["send", "link"]);
  } finally {
    double.restore();
  }
});

actualHandlerTest("an ambiguous provider outcome is durably held for reconciliation and never auto-resent", async () => {
  const double = installRequestDouble({
    actorAt: () => actor(),
    providerSend: () => {
      throw new TypeError("synthetic connection reset after dispatch");
    },
  });
  try {
    const first = await handleBoldSignSend(signingRequest());
    const second = await handleBoldSignSend(signingRequest());
    assertEquals(first.status, 502);
    assertEquals(second.status, 409);
    assertEquals(double.providerCalls, ["send"]);
    assertEquals(await bodyOf(second), {
      error: "BoldSign send outcome requires reconciliation",
    });
  } finally {
    double.restore();
  }
});

actualHandlerTest("provider success with local commit rollback is not reported as success or resent", async () => {
  const double = installRequestDouble({
    actorAt: () => actor(),
    failCommit: true,
  });
  try {
    const first = await handleBoldSignSend(signingRequest());
    const second = await handleBoldSignSend(signingRequest());
    assertEquals(first.status, 503);
    assertEquals(second.status, 409);
    assertEquals(double.providerCalls, ["send"]);
    assertEquals(await bodyOf(first), {
      error: "BoldSign send was accepted but local reconciliation is required",
    });
  } finally {
    double.restore();
  }
});

actualHandlerTest("a committed exact replay reuses the provider document and never sends twice", async () => {
  const double = installRequestDouble({ actorAt: () => actor() });
  try {
    const first = await handleBoldSignSend(signingRequest());
    const second = await handleBoldSignSend(signingRequest());
    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(double.providerCalls, ["send", "link", "link"]);
    assertEquals((await bodyOf(first)).document_id, "synthetic-document");
    assertEquals((await bodyOf(second)).document_id, "synthetic-document");
  } finally {
    double.restore();
  }
});

actualHandlerTest("concurrent exact requests can produce at most one provider send", async () => {
  const double = installRequestDouble({ actorAt: () => actor() });
  try {
    const responses = await Promise.all([
      handleBoldSignSend(signingRequest()),
      handleBoldSignSend(signingRequest()),
    ]);
    assertEquals(double.providerCalls.filter((call) => call === "send").length, 1);
    assert(responses.some((response) => response.status === 200));
    assert(responses.every((response) => [200, 409].includes(response.status)));
  } finally {
    double.restore();
  }
});

actualHandlerTest("unclassified 409 and 429 provider responses remain uncertain and cannot unlock a resend", async () => {
  for (const status of [409, 429]) {
    const double = installRequestDouble({
      actorAt: () => actor(),
      providerSend: () => json({ error: "synthetic provider refusal" }, status),
    });
    try {
      const first = await handleBoldSignSend(signingRequest());
      const second = await handleBoldSignSend(signingRequest());
      assertEquals(first.status, 502, String(status));
      assertEquals(second.status, 409, String(status));
      assertEquals(await bodyOf(second), {
        error: "BoldSign send outcome requires reconciliation",
      });
      assertEquals(double.providerCalls, ["send"]);
    } finally {
      double.restore();
    }
  }
});

actualHandlerTest("failure-receipt rollback is surfaced instead of hiding local persistence loss", async () => {
  const double = installRequestDouble({
    actorAt: () => actor(),
    failFailureRecording: true,
    providerSend: () => {
      throw new TypeError("synthetic transport failure");
    },
  });
  try {
    const response = await handleBoldSignSend(signingRequest());
    assertEquals(response.status, 503);
    assertEquals(await bodyOf(response), {
      error: "BoldSign outcome could not be recorded",
    });
  } finally {
    double.restore();
  }
});

actualHandlerTest("a null 2xx provider body is recorded as ambiguous and cannot be resent", async () => {
  const double = installRequestDouble({
    actorAt: () => actor(),
    providerSend: () => json(null),
  });
  try {
    const first = await handleBoldSignSend(signingRequest());
    const second = await handleBoldSignSend(signingRequest());
    assertEquals(first.status, 502);
    assertEquals(second.status, 409);
    assertEquals(await bodyOf(second), {
      error: "BoldSign send outcome requires reconciliation",
    });
    assertEquals(double.providerCalls, ["send"]);
  } finally {
    double.restore();
  }
});

actualHandlerTest("a definite rejection requires a new idempotency generation before retrying", async () => {
  let sends = 0;
  const double = installRequestDouble({
    actorAt: () => actor(),
    providerSend: () => {
      sends += 1;
      return sends === 1
        ? json({ error: "synthetic invalid template" }, 422)
        : json({ documentId: "synthetic-document-retry" });
    },
  });
  try {
    const first = await handleBoldSignSend(signingRequest());
    const sameGeneration = await handleBoldSignSend(signingRequest());
    const nextGeneration = await handleBoldSignSend(signingRequest(
      "00000000-0000-4000-8000-000000000499",
    ));
    assertEquals(first.status, 502);
    assertEquals(sameGeneration.status, 409);
    assertEquals(await bodyOf(sameGeneration), {
      error: "Previous BoldSign send was rejected; use a new idempotency_key to retry",
    });
    assertEquals(nextGeneration.status, 200);
    assertEquals(double.providerCalls.filter((call) => call === "send").length, 2);
  } finally {
    double.restore();
  }
});

actualHandlerTest("partial embedded-link failure resumes links from the committed document without resending", async () => {
  let linkCalls = 0;
  const double = installRequestDouble({
    actorAt: () => actor(),
    signerCount: 2,
    linkResponse: () => {
      linkCalls += 1;
      if (linkCalls === 2) {
        throw new TypeError("synthetic second-link transport failure");
      }
      return json({ signLink: `https://sign.test/link-${linkCalls}` });
    },
  });
  try {
    const first = await handleBoldSignSend(signingRequest());
    const replay = await handleBoldSignSend(signingRequest());
    assertEquals(first.status, 502);
    assertEquals(replay.status, 200);
    assertEquals(double.providerCalls.filter((call) => call === "send").length, 1);
    assertEquals(double.providerCalls.filter((call) => call === "link").length, 4);
    assertEquals(Object.keys((await bodyOf(replay)).embedded_links as object).length, 2);
  } finally {
    double.restore();
  }
});
