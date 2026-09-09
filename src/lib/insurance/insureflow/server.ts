import { randomUUID } from "node:crypto";
import type { Json } from "@/types/database";
import {
  applyFeedPage,
  chooseRequest,
  InvalidFeedControls,
  requestRecovery,
  validateFeedPage,
  type ReceiverState,
} from "./receiver";
import { FeedTransportError, type SyntheticFeedTransport } from "./transport";

export type ReceiverMapping = { account_id: string; entity_id: string; approved: boolean };
export type ReceiverConnection = {
  id: string;
  organization_id: string;
  source_integration_id: string;
  provider_instance: string;
  mode: "synthetic";
  enabled: boolean;
  ttl_seconds: number;
  mappings: ReceiverMapping[];
  config_generation: number;
  revision: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  state: ReceiverState;
};
export type ReceiverFailureCode = "http_401" | "transport_error" | "invalid_controls" | "configuration_mismatch";
export type ReceiverClaimRequest = { connection_id: string; organization_id: string; lease_token: string; lease_seconds: number };
export type ReceiverFence = Pick<ReceiverConnection, "id" | "organization_id" | "lease_token" | "config_generation" | "revision">;
export interface ReceiverStore {
  claim(request: ReceiverClaimRequest): Promise<ReceiverConnection>;
  commit(fence: ReceiverFence, state: ReceiverState): Promise<ReceiverConnection>;
  fail(fence: ReceiverFence, state: ReceiverState, errorCode: ReceiverFailureCode): Promise<ReceiverConnection>;
}
export type ReceiverServiceRpcClient = {
  rpc(name: "insureflow_receiver_service", args: { p_action: string; p_payload: Json }): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};
export class ReceiverStoreError extends Error {
  constructor(public readonly code: string = "store_error") {
    super(code === "40001" ? "Receiver lease or configuration changed; this result was not applied." : "Receiver persistence could not complete this operation.");
    this.name = "ReceiverStoreError";
  }
}

/** Supply a server-owned service-role client; this adapter never constructs one from request input. */
export function createReceiverStore(client: ReceiverServiceRpcClient): ReceiverStore {
  async function rpc(action: string, payload: unknown): Promise<ReceiverConnection> {
    let result: Awaited<ReturnType<ReceiverServiceRpcClient["rpc"]>>;
    try {
      result = await client.rpc("insureflow_receiver_service", { p_action: action, p_payload: payload as Json });
    } catch {
      throw new ReceiverStoreError();
    }
    if (result.error) throw new ReceiverStoreError(result.error.code === "40001" ? "40001" : "store_error");
    if (!result.data || typeof result.data !== "object") throw new ReceiverStoreError();
    return result.data as ReceiverConnection;
  }
  function fencedPayload(fence: ReceiverFence, state: ReceiverState) {
    return {
      connection_id: fence.id,
      organization_id: fence.organization_id,
      lease_token: fence.lease_token,
      config_generation: fence.config_generation,
      expected_revision: fence.revision,
      state,
    };
  }
  return {
    claim: request => rpc("claim", request),
    commit: (fence, state) => rpc("commit", fencedPayload(fence, state)),
    fail: (fence, state, errorCode) => rpc("fail", { ...fencedPayload(fence, state), error_code: errorCode }),
  };
}

export type SyntheticWorkerOptions = {
  mode: "synthetic";
  connectionId: string;
  organizationId: string;
  providerInstance: string;
  store: ReceiverStore;
  transport: SyntheticFeedTransport;
  maxPages?: number;
  now?: () => string;
};
export type SyntheticWorkerResult = {
  status: "committed" | "failed" | "credential_rejected" | "fenced" | "limit_reached";
  pagesCommitted: number;
};
function isFenceError(error: unknown): boolean {
  return error instanceof ReceiverStoreError && error.code === "40001";
}

/** Bounded synthetic harness only. There is no deployed worker or live polling entry point. */
export async function runSyntheticReceiver(options: SyntheticWorkerOptions): Promise<SyntheticWorkerResult> {
  if (options.mode !== "synthetic" || process.env.NODE_ENV !== "test" || typeof window !== "undefined" || options.transport.mode !== "synthetic") {
    throw new FeedTransportError("live_disabled");
  }
  const maxPages = options.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20 || !/^synthetic:[a-z0-9][a-z0-9_-]{0,63}$/.test(options.providerInstance)) {
    throw new FeedTransportError("invalid_configuration");
  }
  const now = options.now ?? (() => new Date().toISOString());
  let pagesCommitted = 0;
  while (pagesCommitted < maxPages) {
    const leaseToken = randomUUID();
    let connection: ReceiverConnection;
    try {
      connection = await options.store.claim({
        connection_id: options.connectionId,
        organization_id: options.organizationId,
        lease_token: leaseToken,
        lease_seconds: 60,
      });
    } catch (error) {
      if (isFenceError(error)) return { status: "fenced", pagesCommitted };
      throw error;
    }
    if (connection.id !== options.connectionId || connection.organization_id !== options.organizationId || connection.lease_token !== leaseToken) {
      throw new ReceiverStoreError("invalid_store_response");
    }
    const fence: ReceiverFence = {
      id: connection.id,
      organization_id: connection.organization_id,
      lease_token: connection.lease_token,
      config_generation: connection.config_generation,
      revision: connection.revision,
    };
    const fail = async (code: ReceiverFailureCode): Promise<SyntheticWorkerResult> => {
      const state = structuredClone(connection.state);
      if (code === "http_401") {
        state.health = "credential_rejected";
        state.authorization_checked_at = null;
      }
      try {
        await options.store.fail(fence, state, code);
      } catch (error) {
        if (isFenceError(error)) return { status: "fenced", pagesCommitted };
        throw error;
      }
      return { status: code === "http_401" ? "credential_rejected" : "failed", pagesCommitted };
    };
    if (connection.mode !== "synthetic" || !connection.enabled
      || connection.provider_instance !== options.providerInstance
      || connection.source_integration_id !== options.transport.integrationId) {
      return fail("configuration_mismatch");
    }
    if (connection.state.health === "credential_rejected") return fail("http_401");
    const request = chooseRequest(connection.state);
    let next: ReceiverState;
    let continuePolling: boolean;
    try {
      const raw = await options.transport.read({ after: request.after, limit: 100 });
      const page = validateFeedPage(raw, connection.source_integration_id, request.after, 100);
      next = applyFeedPage(connection.state, raw, {
        integrationId: connection.source_integration_id,
        after: request.after,
        mode: request.mode,
        now: now(),
        approvedAccountIds: connection.mappings.filter(mapping => mapping.approved).map(mapping => mapping.account_id),
        limit: 100,
      });
      // A completed replay always needs a separate normal poll before recovered bodies can be visible.
      if (request.mode === "normal" && !page.has_more) next = requestRecovery(next);
      continuePolling = page.has_more || next.recovery_active || request.mode === "recovery";
    } catch (error) {
      if (error instanceof InvalidFeedControls) return fail("invalid_controls");
      return fail(error instanceof FeedTransportError && error.code === "unauthorized" ? "http_401" : "transport_error");
    }
    // A failed/uncertain atomic commit is NOT translated into a failure write or automatic retry.
    try {
      await options.store.commit(fence, next);
    } catch (error) {
      if (isFenceError(error)) return { status: "fenced", pagesCommitted };
      throw error;
    }
    pagesCommitted++;
    if (!continuePolling) return { status: "committed", pagesCommitted };
  }
  return { status: "limit_reached", pagesCommitted };
}
