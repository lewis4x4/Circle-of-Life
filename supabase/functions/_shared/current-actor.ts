import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type CurrentEdgeActor = {
  userId: string;
  sessionId: string;
  email: string | null;
  organizationId: string;
  role: string;
  claimVersion: number;
  accessibleFacilityIds: readonly string[];
};

type ActorRpcClient = Pick<SupabaseClient, "rpc">;

export type CurrentActorAuthorization = {
  actor: CurrentEdgeActor;
  accessToken: string;
  revalidate: (facilityId?: string | null) => Promise<void>;
};

export type CurrentActorOptions = {
  allowedRoles?: readonly string[];
  createUserClient?: (accessToken: string) => ActorRpcClient;
};

type ActorRpcPayload = {
  user_id?: unknown;
  session_id?: unknown;
  email?: unknown;
  organization_id?: unknown;
  app_role?: unknown;
  auth_claim_version?: unknown;
  accessible_facility_ids?: unknown;
};

export class CurrentActorError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: "Unauthorized" | "Forbidden",
  ) {
    super(message);
    this.name = "CurrentActorError";
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function defaultCreateUserClient(accessToken: string): ActorRpcClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new CurrentActorError(401, "Unauthorized");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function parseActor(value: unknown): CurrentEdgeActor | null {
  const payload = (Array.isArray(value) ? value[0] : value) as
    | ActorRpcPayload
    | null
    | undefined;
  if (!payload || typeof payload !== "object") return null;

  const facilityIds = payload.accessible_facility_ids;
  if (
    typeof payload.user_id !== "string" ||
    typeof payload.session_id !== "string" ||
    !(typeof payload.email === "string" || payload.email === null) ||
    typeof payload.organization_id !== "string" ||
    typeof payload.app_role !== "string" ||
    typeof payload.auth_claim_version !== "number" ||
    !Number.isInteger(payload.auth_claim_version) ||
    !Array.isArray(facilityIds) ||
    facilityIds.some((id) => typeof id !== "string")
  ) {
    return null;
  }

  return {
    userId: payload.user_id,
    sessionId: payload.session_id,
    email: payload.email,
    organizationId: payload.organization_id,
    role: payload.app_role,
    claimVersion: payload.auth_claim_version,
    accessibleFacilityIds: [...facilityIds].sort(),
  };
}

async function readCurrentActor(
  client: ActorRpcClient,
): Promise<CurrentEdgeActor> {
  const { data, error } = await client.rpc("haven_current_edge_actor");
  if (error) throw new CurrentActorError(401, "Unauthorized");
  const actor = parseActor(data);
  if (!actor) throw new CurrentActorError(401, "Unauthorized");
  return actor;
}

function sameActorBinding(
  initial: CurrentEdgeActor,
  current: CurrentEdgeActor,
): boolean {
  return initial.userId === current.userId &&
    initial.organizationId === current.organizationId &&
    initial.role === current.role &&
    initial.claimVersion === current.claimVersion;
}

export async function requireCurrentActor(
  req: Request,
  options: CurrentActorOptions = {},
): Promise<CurrentActorAuthorization> {
  const accessToken = bearerToken(req);
  if (!accessToken) throw new CurrentActorError(401, "Unauthorized");

  const client = (options.createUserClient ?? defaultCreateUserClient)(
    accessToken,
  );
  const actor = await readCurrentActor(client);
  if (options.allowedRoles && !options.allowedRoles.includes(actor.role)) {
    throw new CurrentActorError(403, "Forbidden");
  }

  return {
    actor,
    accessToken,
    revalidate: async (facilityId?: string | null) => {
      const current = await readCurrentActor(client);
      if (!sameActorBinding(actor, current)) {
        throw new CurrentActorError(403, "Forbidden");
      }
      if (
        facilityId &&
        !current.accessibleFacilityIds.includes(facilityId)
      ) {
        throw new CurrentActorError(403, "Forbidden");
      }
    },
  };
}

export function currentActorErrorResponse(
  error: unknown,
  headers: HeadersInit = {},
): Response {
  const status = error instanceof CurrentActorError ? error.status : 401;
  const message = status === 403 ? "Forbidden" : "Unauthorized";
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export function currentActorOrProviderErrorResponse(
  error: unknown,
  options: { status: 502 | 504; message: string; headers?: HeadersInit },
): Response {
  if (error instanceof CurrentActorError) {
    return currentActorErrorResponse(error, options.headers);
  }
  return new Response(JSON.stringify({ error: options.message }), {
    status: options.status,
    headers: { ...(options.headers ?? {}), "Content-Type": "application/json" },
  });
}

export function filterRowsToCurrentActorFacilities<
  T extends { organization_id?: unknown; facility_id?: unknown },
>(
  actor: CurrentEdgeActor,
  rows: readonly T[],
  options: { includeOrganizationWide?: boolean } = {},
): T[] {
  return rows.filter((row) =>
    row.organization_id === actor.organizationId &&
    (typeof row.facility_id === "string"
      ? actor.accessibleFacilityIds.includes(row.facility_id)
      : row.facility_id === null && options.includeOrganizationWide === true &&
        ["owner", "org_admin"].includes(actor.role))
  );
}

export function canUseCurrentActorFacilityScope(
  actor: CurrentEdgeActor,
  facilityId: string | null | undefined,
  options: { allowOrganizationWide?: boolean } = {},
): boolean {
  if (facilityId) return actor.accessibleFacilityIds.includes(facilityId);
  return options.allowOrganizationWide === true &&
    ["owner", "org_admin"].includes(actor.role);
}

export async function withCurrentActorRevalidation<T>(
  authorization: CurrentActorAuthorization,
  operation: () => Promise<T>,
  facilityId?: string | null,
): Promise<T> {
  await authorization.revalidate(facilityId);
  return await operation();
}
