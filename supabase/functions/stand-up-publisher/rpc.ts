import {
  type AggregateWorkspace,
  type DurablePending,
  FACILITIES,
  PublisherError,
  type PublisherLease,
  type PublisherStore,
  type StorePendingInput,
} from "./publisher.ts";

type RpcError = { code?: string; message?: string };
type RpcResult = { data: unknown; error: RpcError | null };
export type RpcClient = {
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

function pending(value: unknown): DurablePending | null {
  if (value === null || value === undefined) return null;
  const row = object(value, "pending publisher state");
  const body = row.body;
  const fingerprint = row.fingerprint;
  const sequence = integer(row.sequence, "pending sequence");
  const firstSentAt = row.first_sent_at;
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new PublisherError(
      "Invalid pending fingerprint",
      "database_contract",
    );
  }
  if (
    typeof body !== "string" ||
    new TextEncoder().encode(body).length > 1_000_000 ||
    (firstSentAt !== null && firstSentAt !== undefined &&
      typeof firstSentAt !== "string")
  ) {
    throw new PublisherError(
      "Inconsistent durable pending state",
      "database_contract",
    );
  }
  let bodySequence: unknown;
  try {
    bodySequence = object(JSON.parse(body), "durable pending body").sequence;
  } catch {
    throw new PublisherError(
      "Invalid durable pending body",
      "database_contract",
    );
  }
  if (bodySequence !== sequence) {
    throw new PublisherError(
      "Inconsistent durable pending sequence",
      "database_contract",
    );
  }
  return {
    body,
    fingerprint,
    sequence,
    first_sent_at: typeof firstSentAt === "string" ? firstSentAt : null,
  };
}

export class SupabasePublisherStore implements PublisherStore {
  private leaseToken: string | null = null;
  private generation: number | null = null;

  constructor(
    private readonly client: RpcClient,
    private readonly organizationId: string,
  ) {}

  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.client.rpc(name, args);
    if (result.error) {
      throw new PublisherError(
        `Publisher database RPC failed: ${name}`,
        result.error.code ?? "database_failed",
      );
    }
    return result.data;
  }

  async acquire(runId: string): Promise<PublisherLease | null> {
    const row = object(
      await this.call("stand_up_publisher_acquire", {
        p_run_id: runId,
        p_lease_seconds: 50,
      }),
      "publisher acquire",
    );
    if (row.acquired === false) return null;
    if (row.acquired !== true) {
      throw new PublisherError("Invalid publisher lease", "database_contract");
    }
    if (typeof row.lease_token !== "string" || !row.lease_token) {
      throw new PublisherError(
        "Invalid publisher lease token",
        "database_contract",
      );
    }
    this.leaseToken = row.lease_token;
    this.generation = integer(row.generation, "publisher generation");
    const fingerprint = row.last_fingerprint;
    const admittedAt = row.last_admitted_at;
    const rawMap = object(row.facility_map, "protected facility mapping");
    const facilityMap: Record<string, string> = {};
    if (
      Object.keys(rawMap).sort().join("|") !== [...FACILITIES].sort().join("|")
    ) {
      throw new PublisherError(
        "Invalid protected facility mapping",
        "database_contract",
      );
    }
    for (const name of FACILITIES) {
      if (typeof rawMap[name] !== "string") {
        throw new PublisherError(
          "Invalid protected facility mapping",
          "database_contract",
        );
      }
      facilityMap[name] = rawMap[name] as string;
    }
    if (
      fingerprint !== null && fingerprint !== undefined &&
      (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))
    ) {
      throw new PublisherError(
        "Invalid publisher fingerprint",
        "database_contract",
      );
    }
    if (
      admittedAt !== null && admittedAt !== undefined &&
      typeof admittedAt !== "string" && typeof admittedAt !== "number"
    ) {
      throw new PublisherError(
        "Invalid publisher admission time",
        "database_contract",
      );
    }
    return {
      leaseToken: row.lease_token,
      generation: this.generation,
      facilityMap: facilityMap as PublisherLease["facilityMap"],
      sequence: integer(row.sequence, "publisher sequence"),
      lastFingerprint: typeof fingerprint === "string" ? fingerprint : null,
      lastAdmittedAt: admittedAt as string | number | null ?? null,
      pending: pending(row.pending),
    };
  }

  async loadWorkspace(week: string): Promise<AggregateWorkspace> {
    return object(
      await this.call("stand_up_export_aggregate", {
        p_organization_id: this.organizationId,
        p_week_start: week,
      }),
      "aggregate export",
    ) as AggregateWorkspace;
  }

  async storePending(
    runId: string,
    value: StorePendingInput,
  ): Promise<DurablePending> {
    const row = object(
      await this.call("stand_up_publisher_store_pending", {
        p_run_id: runId,
        p_lease_token: this.requiredLeaseToken(),
        p_generation: this.requiredGeneration(),
        p_body: value.body,
        p_fingerprint: value.fingerprint,
        p_sequence: value.sequence,
        p_first_sent_at: value.firstSentAt,
      }),
      "store pending",
    );
    if (row.stored !== true || row.sequence !== value.sequence) {
      throw new PublisherError(
        "Pending body was not persisted",
        "database_contract",
      );
    }
    return {
      body: value.body,
      fingerprint: value.fingerprint,
      sequence: value.sequence,
      first_sent_at: value.firstSentAt,
    };
  }

  async complete(
    runId: string,
    receiptId: string,
    replayed: boolean,
    admittedAt: string | null,
  ): Promise<void> {
    await this.call("stand_up_publisher_complete", {
      p_run_id: runId,
      p_lease_token: this.requiredLeaseToken(),
      p_generation: this.requiredGeneration(),
      p_receipt_id: receiptId,
      p_replayed: replayed,
      p_admitted_at: admittedAt,
    });
  }

  async reject(
    runId: string,
    status: number,
    definite: boolean,
  ): Promise<void> {
    await this.call("stand_up_publisher_reject", {
      p_run_id: runId,
      p_lease_token: this.requiredLeaseToken(),
      p_generation: this.requiredGeneration(),
      p_http_status: status,
      p_definite: definite,
    });
  }

  async release(
    runId: string,
    outcome: string,
    errorCode?: string,
  ): Promise<void> {
    await this.call("stand_up_publisher_release", {
      p_run_id: runId,
      p_lease_token: this.requiredLeaseToken(),
      p_generation: this.requiredGeneration(),
      p_outcome: outcome,
      p_error_code: errorCode ?? null,
    });
    this.leaseToken = null;
    this.generation = null;
  }

  private requiredLeaseToken(): string {
    if (!this.leaseToken) {
      throw new PublisherError(
        "Publisher lease is not held",
        "database_contract",
      );
    }
    return this.leaseToken;
  }

  private requiredGeneration(): number {
    if (this.generation === null) {
      throw new PublisherError(
        "Publisher generation is not held",
        "database_contract",
      );
    }
    return this.generation;
  }
}
