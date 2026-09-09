import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  revalidateCurrentApiActor,
  type CurrentApiActor,
} from "@/lib/auth/current-api-actor";
import { InsuranceInputError } from "./extraction";
import type { Json } from "@/types/database";
import type { WorkspaceAction } from "./workspace-schema";
export const INSURANCE_BUCKET = "insurance-originals";
export const MANAGER_ROLES = ["owner", "org_admin"] as const;
export class InsuranceRpcError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
// New migrations expose JSON RPCs; isolate the cast until the generated DB schema is refreshed.
type RpcClient = {
  rpc(
    name: string,
    args: {
      p_action: string;
      p_payload: Json;
    },
  ): PromiseLike<{
    data: unknown;
    error: {
      message: string;
      code?: string;
    } | null;
  }>;
};
async function invoke<T>(
  client: unknown,
  name: string,
  action: string,
  payload: unknown,
): Promise<T> {
  const result = await (client as RpcClient).rpc(name, {
    p_action: action,
    p_payload: payload as Json,
  });
  if (result.error)
    throw new InsuranceRpcError(result.error.message, result.error.code);
  return result.data as T;
}
export function workspaceRpc<T>(
  actor: CurrentApiActor,
  action: WorkspaceAction,
  payload: unknown,
): Promise<T> {
  return invoke(actor.client, "insurance_workspace", action, payload);
}
export async function processingRpc<T>(
  actor: CurrentApiActor,
  action:
    | "register_document"
    | "finish_document"
    | "start_extraction"
    | "finish_extraction",
  payload: Record<string, unknown>,
): Promise<T> {
  const current = await revalidateCurrentApiActor(actor, {
    allowedRoles: MANAGER_ROLES,
    scope: `insurance.${action}`,
  });
  if ("response" in current)
    throw new InsuranceInputError(
      "Your access changed. Sign in again to continue.",
      current.response.status,
    );
  if (current.actor.organizationId !== actor.organizationId)
    throw new InsuranceInputError("Document not found.", 404);
  return invoke(current.actor.admin, "insurance_processing", action, {
    ...payload,
    actor_id: current.actor.id,
    organization_id: current.actor.organizationId,
  });
}
export function insuranceError(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: "Invalid insurance request.",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  if (error instanceof InsuranceInputError)
    return NextResponse.json(
      { error: error.message },
      {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  if (error instanceof InsuranceRpcError) {
    const msg = error.message;
    if (
      ["28000", "28P01", "PGRST301", "PGRST302"].includes(error.code ?? "") ||
      /HAVEN_AUTHORIZATION_STALE|authentication required/i.test(msg)
    ) {
      return noStoreJson(
        { error: "Your session changed. Sign in again to continue." },
        401,
      );
    }
    const status =
      error.code === "42501" || /forbidden|permission|not authorized/i.test(msg)
        ? 403
        : error.code === "P0002" || /not found/i.test(msg)
          ? 404
          : error.code === "23505" ||
              error.code === "40001" ||
              /stale|conflict|revision|already processing/i.test(msg)
            ? 409
            : error.code === "22023" ||
                /required|invalid|evidence|must |cannot |outside|mismatch/i.test(
                  msg,
                )
              ? 400
              : 500;
    return NextResponse.json(
      {
        error:
          status === 500 ? "Insurance operation failed. Please retry." : msg,
      },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    { error: "Insurance operation failed. Please retry or use manual review." },
    { status: 500, headers: { "Cache-Control": "private, no-store" } },
  );
}
export function noStoreJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function withNoStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
