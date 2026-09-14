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
export type ExportPlanResult =
  | { state: "disabled" | "no_export" }
  | { state: "review_required"; code: string }
  | { state: "export_applied"; export_id: string }
  | {
    state: "export_required";
    export_id: string;
    updates: Record<string, ParsedWorkbook["records"][number]["values"]>;
  };
export type ExportSnapshotInput = {
  workbook_id: string;
  week_start: string;
  source_sha256: string;
  drive: ApplySnapshotInput["drive"];
  observed_at: string;
  records: ParsedWorkbook["records"];
};
export type CompleteExportInput = ExportSnapshotInput & { export_id: string };

export interface BridgeRpc {
  loadContext(
    input: { workbook_id: string; week_start: string },
  ): Promise<BridgeContext>;
  applySnapshot(input: ApplySnapshotInput): Promise<ApplySnapshotResult>;
  prepareExport(input: ExportSnapshotInput): Promise<ExportPlanResult>;
  completeExport(
    input: CompleteExportInput,
  ): Promise<{ state: "synchronized" }>;
  abandonExport(input: {
    workbook_id: string;
    week_start: string;
    export_id: string;
    reason:
      | "provider_rejected"
      | "provider_content_changed"
      | "readback_mismatch";
  }): Promise<void>;
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
  async #exportCall(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.#post("stand_up_google_export_bridge", {
      p_action: action,
      p_payload: payload,
    });
  }
  async #post(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.fetcher(
      `${this.url.replace(/\/$/, "")}/rest/v1/rpc/${endpoint}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
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
  async prepareExport(input: ExportSnapshotInput): Promise<ExportPlanResult> {
    const result = await this.#exportCall("prepare_export", input);
    if (
      !result || typeof result !== "object" ||
      ![
        "disabled",
        "no_export",
        "review_required",
        "export_applied",
        "export_required",
      ]
        .includes((result as ExportPlanResult).state)
    ) throw new Error("Stand Up export plan is invalid");
    const plan = result as ExportPlanResult;
    if (
      plan.state === "export_required" &&
      (!plan.export_id || !plan.updates || typeof plan.updates !== "object")
    ) throw new Error("Stand Up export plan is invalid");
    if (plan.state === "export_applied" && !plan.export_id) {
      throw new Error("Stand Up export plan is invalid");
    }
    return plan;
  }
  async completeExport(
    input: CompleteExportInput,
  ): Promise<{ state: "synchronized" }> {
    const result = await this.#post("stand_up_google_complete_export", {
      p_payload: input,
    });
    if (
      !result || typeof result !== "object" ||
      (result as { state?: string }).state !== "synchronized"
    ) throw new Error("Stand Up export completion is invalid");
    return result as { state: "synchronized" };
  }
  async abandonExport(input: {
    workbook_id: string;
    week_start: string;
    export_id: string;
    reason:
      | "provider_rejected"
      | "provider_content_changed"
      | "readback_mismatch";
  }): Promise<void> {
    const result = await this.#exportCall("abandon_export", input);
    if (
      !result || typeof result !== "object" ||
      (result as { state?: string }).state !== "abandoned"
    ) throw new Error("Stand Up export abandonment is invalid");
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
