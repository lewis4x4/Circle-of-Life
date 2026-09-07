import {
  assert,
  assertEquals,
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
  onLinkRequest?: () => void;
};

function actor(
  role = "nurse",
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
  const databaseMutations: string[] = [];
  let actorRpcCalls = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = methodOf(input, init);

    if (url.host === "supabase.test") {
      if (url.pathname === "/rest/v1/rpc/haven_current_edge_actor") {
        actorRpcCalls += 1;
        return json(options.actorAt(actorRpcCalls));
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
        return json([{
          id: IDS.signer,
          signer_name: "Synthetic signer",
          signer_email: "signer@example.test",
          signer_role: "resident_representative",
          routing_order: 1,
        }]);
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
        return json({ documentId: "synthetic-document" });
      }
      if (url.pathname === "/v1/document/getEmbeddedSignLink") {
        providerCalls.push("link");
        options.onLinkRequest?.();
        return json({ signLink: "https://sign.test/synthetic-link" });
      }
      throw new Error(`Unhandled BoldSign request: ${method} ${url}`);
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  return {
    providerCalls,
    databaseMutations,
    actorRpcCalls: () => actorRpcCalls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function signingRequest(): Request {
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
    ...["facility_admin", "manager", "nurse"].map((role) => ({
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
    actorAt: (rpcCall) => rpcCall === 1 ? actor() : actor("nurse", []),
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
    actorAt: (rpcCall) => rpcCall < 4 ? actor() : actor("nurse", []),
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

actualHandlerTest("actual signing handler preserves an authorized multi-site nurse send and embedded-link response", async () => {
  const allowed = actor("nurse", [IDS.otherFacility, IDS.facility]);
  const double = installRequestDouble({ actorAt: () => allowed });
  try {
    const response = await handleBoldSignSend(signingRequest());
    const body = await bodyOf(response);
    assertEquals(response.status, 200);
    assertEquals(double.providerCalls, ["send", "link"]);
    assertEquals(double.actorRpcCalls(), 4);
    assertEquals(body.document_id, "synthetic-document");
    assertEquals(body.embedded_links, {
      [IDS.signer]: "https://sign.test/synthetic-link",
    });
    assert(
      double.databaseMutations.includes(
        "PATCH /rest/v1/resident_contracts",
      ),
    );
    assert(
      double.databaseMutations.includes(
        "PATCH /rest/v1/resident_contract_signers",
      ),
    );
    assert(
      double.databaseMutations.includes(
        "POST /rest/v1/resident_contract_events",
      ),
    );
  } finally {
    double.restore();
  }
});

actualHandlerTest("characterizes remaining link disclosure if access changes while the final provider request is in flight", async () => {
  let liveActor = actor();
  const double = installRequestDouble({
    actorAt: () => liveActor,
    onLinkRequest: () => {
      liveActor = actor("nurse", []);
    },
  });
  try {
    const response = await handleBoldSignSend(signingRequest());
    const body = await bodyOf(response);
    assertEquals(response.status, 200);
    assertEquals(double.providerCalls, ["send", "link"]);
    assertEquals(double.actorRpcCalls(), 4);
    assertEquals(liveActor.accessible_facility_ids, []);
    assertEquals(body.embedded_links, {
      [IDS.signer]: "https://sign.test/synthetic-link",
    });
  } finally {
    double.restore();
  }
});
