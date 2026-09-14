import type { FacilityMap, HeldBaseline, ParsedWorkbook } from "./xlsx.ts";
import type { DriveMetadata, Fetcher } from "./google.ts";

export type GoogleConnection = {
  state?: string;
  credential_fingerprint?: string;
  last_connected_at?: string | null;
};
export type BridgeContext = {
  state?: "disabled";
  facility_map: FacilityMap;
  baselines: Record<string, HeldBaseline>;
  google_connection?: GoogleConnection;
};
export type ApplySnapshotInput = {
  workbook_id: string;
  week_start: string;
  schema_version: "standup-2026-v1";
  source_sha256: string;
  drive: {
    etag: string;
    version: string;
    head_revision_id: string;
    md5_checksum: string;
    file_size: number;
  };
  observed_at: string;
  credential_fingerprint: string;
  records: ParsedWorkbook["records"];
  locations: ParsedWorkbook["locations"];
};
export type ApplySnapshotResult = {
  state: "synchronized" | "review_required";
  run_id: string;
  baselines?: Record<string, HeldBaseline>;
  review?: unknown[];
};

export interface BridgeRpc {
  loadContext(
    input: { workbook_id: string; week_start: string },
  ): Promise<BridgeContext>;
  applySnapshot(input: ApplySnapshotInput): Promise<ApplySnapshotResult>;
  recordFailure(
    input: {
      workbook_id: string;
      week_start: string;
      error_code: string;
      observed_at: string;
      detail: Record<string, unknown>;
    },
  ): Promise<void>;
}

export class SupabaseBridgeRpc implements BridgeRpc {
  constructor(
    readonly url: string,
    readonly serviceRoleKey: string,
    readonly fetcher: Fetcher = fetch,
  ) {
    if (!/^https:\/\//.test(url) || !serviceRoleKey) {
      throw new Error("Supabase bridge configuration is invalid");
    }
  }
  async #call(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.fetcher(
      `${this.url.replace(/\/$/, "")}/rest/v1/rpc/stand_up_google_bridge`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_action: action, p_payload: payload }),
      },
    );
    if (!response.ok) {
      throw new Error(`Stand Up bridge RPC failed (${response.status})`);
    }
    return await response.json();
  }
  async loadContext(
    input: { workbook_id: string; week_start: string },
  ): Promise<BridgeContext> {
    const result = await this.#call("load_context", input);
    if (!result || typeof result !== "object") {
      throw new Error("Stand Up bridge context is invalid");
    }
    if ((result as BridgeContext).state === "disabled") {
      return result as BridgeContext;
    }
    if (!(result as BridgeContext).facility_map) {
      throw new Error("Stand Up bridge context is invalid");
    }
    return result as BridgeContext;
  }
  async applySnapshot(input: ApplySnapshotInput): Promise<ApplySnapshotResult> {
    const result = await this.#call("apply_snapshot", input);
    if (
      !result || typeof result !== "object" ||
      !["synchronized", "review_required"].includes(
        (result as ApplySnapshotResult).state,
      )
    ) throw new Error("Stand Up bridge receipt is invalid");
    return result as ApplySnapshotResult;
  }
  async recordFailure(
    input: {
      workbook_id: string;
      week_start: string;
      error_code: string;
      observed_at: string;
      detail: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.#call("record_failure", input);
  }
}

export function driveReceipt(metadata: DriveMetadata) {
  return {
    etag: metadata.etag,
    version: metadata.version,
    head_revision_id: metadata.headRevisionId,
    md5_checksum: metadata.md5Checksum.toLowerCase(),
    file_size: Number(metadata.fileSize),
  };
}
