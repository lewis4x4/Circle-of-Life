import { z } from "zod";
import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
} from "@/lib/auth/current-api-actor";
import {
  MANAGER_ROLES,
  noStoreJson,
  withNoStore,
} from "@/lib/insurance/workspace-server";
import {
  agencySummaryProjectionSchema,
  connectionMayDisplay,
} from "@/components/insurance/agency-summary-contract";

export const dynamic = "force-dynamic";
const filtersSchema = z
  .object({
    connection_id: z.uuid().optional(),
    entity_id: z.uuid().optional(),
  })
  .strict();
type ReadClient = {
  rpc(
    name: "insureflow_receiver_read",
    args: { p_action: "list"; p_payload: z.infer<typeof filtersSchema> },
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export async function GET(request: Request) {
  try {
    const auth = await requireCurrentApiActor({
      allowedRoles: MANAGER_ROLES,
      scope: "insurance.agency-summaries.read",
    });
    if ("response" in auth) return withNoStore(auth.response);
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    const filters = filtersSchema.safeParse(Object.fromEntries(params));
    if (!filters.success || new Set(keys).size !== keys.length)
      return noStoreJson({ error: "Invalid agency summary filters." }, 400);
    const result = await (auth.actor.client as unknown as ReadClient).rpc(
      "insureflow_receiver_read",
      { p_action: "list", p_payload: filters.data },
    );
    if (result.error) {
      const code = result.error.code;
      if (["28000", "28P01", "PGRST301", "PGRST302"].includes(code ?? ""))
        return noStoreJson(
          {
            error:
              "Your session changed. Sign in again to view agency summaries.",
          },
          401,
        );
      if (code === "42501")
        return noStoreJson(
          {
            error:
              "Agency summaries are restricted to authorized insurance managers.",
          },
          403,
        );
      return noStoreJson(
        { error: "Agency summaries are unavailable. Refresh to retry." },
        503,
      );
    }
    const projection = agencySummaryProjectionSchema.safeParse(result.data);
    if (!projection.success)
      return noStoreJson(
        { error: "Agency summaries could not be safely displayed." },
        502,
      );
    const current = await revalidateCurrentApiActor(auth.actor, {
      allowedRoles: MANAGER_ROLES,
      scope: "insurance.agency-summaries.publish",
    });
    if ("response" in current) return withNoStore(current.response);
    if (
      current.actor.organizationId !== auth.actor.organizationId ||
      current.actor.id !== auth.actor.id
    )
      return noStoreJson(
        { error: "Your organization access changed. Refresh to retry." },
        403,
      );
    const readAt = new Date();
    return noStoreJson({
      ...projection.data,
      read_at: readAt.toISOString(),
      connections: projection.data.connections.map((connection) => {
        const eligible =
          connectionMayDisplay(connection) &&
          Date.parse(connection.authorization_valid_until!) > readAt.valueOf();
        return {
          ...connection,
          state:
            !connection.enabled || connection.state === "disabled"
              ? "disabled"
              : !eligible
                ? "unavailable"
                : connection.state,
          summaries: eligible ? connection.summaries : [],
        };
      }),
    });
  } catch {
    return noStoreJson(
      { error: "Agency summaries are unavailable. Refresh to retry." },
      503,
    );
  }
}
