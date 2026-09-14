import { FACILITIES, PublisherError } from "../stand-up-publisher/publisher.ts";
import {
  type HistoryFingerprint,
  type HistoryLease,
  type HistoryPending,
  type HistoryStore,
} from "./history.ts";

type RpcResult = { data: unknown; error: { code?: string } | null };
export type HistoryRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublisherError(
      `Invalid ${label} RPC response`,
      "database_contract",
    );
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PublisherError(`Invalid ${label}`, "database_contract");
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new PublisherError(`Invalid ${label}`, "database_contract");
  }
  return value;
}

function pending(value: unknown, baseSequence: number): HistoryPending[] {
  if (!Array.isArray(value) || value.length > 156) {
    throw new PublisherError(
      "Invalid history pending queue",
      "database_contract",
    );
  }
  return value.map((item, index) => {
    const row = object(item, "history pending item");
    const sequence = integer(row.sequence, "history pending sequence");
    if (
      typeof row.identity !== "string" ||
      !/^\d{4}-\d{2}-\d{2}:[012]$/.test(row.identity) ||
      typeof row.body !== "string" ||
      new TextEncoder().encode(row.body).length > 1_048_576 ||
      typeof row.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
      sequence !== baseSequence + index + 1
    ) {
      throw new PublisherError(
        "Invalid history pending item",
        "database_contract",
      );
    }
    let body: Record<string, unknown>;
    try {
      body = object(JSON.parse(row.body), "history pending body");
    } catch {
      throw new PublisherError(
        "Invalid history pending body",
        "database_contract",
      );
    }
    if (
      body.sequence !== sequence ||
      body.dataset !== "standup_weekly_history"
    ) {
      throw new PublisherError(
        "History pending sequence mismatch",
        "database_contract",
      );
    }
    return {
      identity: row.identity,
      body: row.body,
      fingerprint: row.fingerprint,
      sequence,
      source_as_of: timestamp(row.source_as_of, "history source timestamp"),
      first_sent_at: timestamp(
        row.first_sent_at,
        "history first attempt timestamp",
      ),
    };
  });
}

export class SupabaseHistoryStore implements HistoryStore {
  private leaseToken: string | null = null;
  private generation: number | null = null;
  private sequence: number | null = null;

  constructor(
    private readonly client: HistoryRpcClient,
    private readonly organizationId: string,
  ) {}

  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.client.rpc(name, args);
    if (result.error) {
      throw new PublisherError(
        `History publisher RPC failed: ${name}`,
        result.error.code ?? "database_failed",
      );
    }
    return result.data;
  }

  private token(): string {
    if (!this.leaseToken) {
      throw new PublisherError(
        "History publisher lease is not held",
        "database_contract",
      );
    }
    return this.leaseToken;
  }

  async acquire(runId: string): Promise<HistoryLease | null> {
    const row = object(
      await this.call("stand_up_history_publisher_acquire", {
        p_run_id: runId,
        p_lease_seconds: 50,
      }),
      "history acquire",
    );
    if (row.acquired === false) return null;
    if (
      row.acquired !== true || typeof row.lease_token !== "string" ||
      !row.lease_token
    ) {
      throw new PublisherError(
        "Invalid history publisher lease",
        "database_contract",
      );
    }
    this.leaseToken = row.lease_token;
    this.generation = integer(row.generation, "history publisher generation");
    const map = object(row.facility_map, "history facility map");
    if (
      Object.keys(map).sort().join("|") !== [...FACILITIES].sort().join("|")
    ) {
      throw new PublisherError(
        "Invalid protected history facility map",
        "database_contract",
      );
    }
    const facilityMap: Record<string, string> = {};
    for (const name of FACILITIES) {
      if (typeof map[name] !== "string") {
        throw new PublisherError(
          "Invalid protected history facility map",
          "database_contract",
        );
      }
      facilityMap[name] = map[name] as string;
    }
    const rawFingerprints = object(
      row.fingerprints ?? {},
      "history fingerprints",
    );
    const fingerprints: Record<string, HistoryFingerprint> = {};
    for (const [identity, value] of Object.entries(rawFingerprints)) {
      const item = object(value, "history fingerprint");
      if (
        !/^\d{4}-\d{2}-\d{2}:[012]$/.test(identity) ||
        typeof item.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.fingerprint) ||
        typeof item.published_at !== "string"
      ) {
        throw new PublisherError(
          "Invalid history fingerprint state",
          "database_contract",
        );
      }
      fingerprints[identity] = {
        fingerprint: item.fingerprint,
        published_at: timestamp(
          item.published_at,
          "history publication timestamp",
        ),
      };
    }
    const sequence = integer(row.sequence, "history sequence");
    this.sequence = sequence;
    const lastSourceAsOf = row.last_source_as_of === null
      ? null
      : timestamp(row.last_source_as_of, "last history source timestamp");
    return {
      leaseToken: row.lease_token,
      generation: this.generation,
      sequence,
      lastSourceAsOf,
      facilityMap: facilityMap as HistoryLease["facilityMap"],
      fingerprints,
      pending: pending(row.pending ?? [], sequence),
    };
  }

  async loadArchive(fromWeek: string, toWeek: string): Promise<unknown> {
    return await this.call("stand_up_export_history", {
      p_organization_id: this.organizationId,
      p_from_week: fromWeek,
      p_to_week: toWeek,
    });
  }

  async storeQueue(runId: string, items: HistoryPending[]): Promise<void> {
    const checkedItems = pending(items, this.currentSequence());
    const result = object(
      await this.call("stand_up_history_publisher_store_queue", {
        p_run_id: runId,
        p_lease_token: this.token(),
        p_generation: this.currentGeneration(),
        p_items: checkedItems,
      }),
      "history store queue",
    );
    if (result.stored !== true || result.count !== checkedItems.length) {
      throw new PublisherError(
        "History queue was not durably stored",
        "database_contract",
      );
    }
  }

  async completeHead(
    runId: string,
    identity: string,
    sequence: number,
    fingerprint: string,
    receiptId: string,
  ): Promise<void> {
    await this.call("stand_up_history_publisher_complete_head", {
      p_run_id: runId,
      p_lease_token: this.token(),
      p_generation: this.currentGeneration(),
      p_identity: identity,
      p_sequence: sequence,
      p_fingerprint: fingerprint,
      p_receipt_id: receiptId,
    });
    this.sequence = sequence;
  }

  async rejectHead(
    runId: string,
    identity: string,
    sequence: number,
    fingerprint: string,
    status: number,
  ): Promise<void> {
    await this.call("stand_up_history_publisher_reject_head", {
      p_run_id: runId,
      p_lease_token: this.token(),
      p_generation: this.currentGeneration(),
      p_identity: identity,
      p_sequence: sequence,
      p_fingerprint: fingerprint,
      p_http_status: status,
    });
  }

  async release(
    runId: string,
    outcome: string,
    errorCode?: string,
  ): Promise<void> {
    await this.call("stand_up_history_publisher_release", {
      p_run_id: runId,
      p_lease_token: this.token(),
      p_generation: this.currentGeneration(),
      p_outcome: outcome,
      p_error_code: errorCode ?? null,
    });
    this.leaseToken = null;
    this.generation = null;
    this.sequence = null;
  }

  private currentGeneration(): number {
    if (this.generation === null) {
      throw new PublisherError(
        "History publisher generation is not held",
        "database_contract",
      );
    }
    return this.generation;
  }

  private currentSequence(): number {
    if (this.sequence === null) {
      throw new PublisherError(
        "History publisher sequence is not held",
        "database_contract",
      );
    }
    return this.sequence;
  }
}
