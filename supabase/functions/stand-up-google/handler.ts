import {
  credentialFingerprint,
  type Fetcher,
  GoogleDriveClient,
  GoogleReconnectRequired,
  GoogleSnapshotUnstable,
  ProviderHttpError,
  refreshGoogleAccessToken,
} from "./google.ts";
import { type BridgeRpc, driveReceipt, SupabaseBridgeRpc } from "./rpc.ts";
import {
  parseWorkbook,
  patchWorkbook,
  retainUnchangedHeldOvertime,
  WorkbookError,
} from "./xlsx.ts";

export type EnvReader = (name: string) => string | undefined;
type Dependencies = {
  env?: EnvReader;
  fetcher?: Fetcher;
  rpc?: BridgeRpc;
  now?: () => Date;
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index % Math.max(a.length, 1)] ?? 0) ^
      (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return difference === 0;
}

function required(env: EnvReader, name: string): string {
  const value = env(name);
  if (!value) throw new Error("Hosted Stand Up bridge is not configured");
  return value;
}

function boundedFetcher(fetcher: Fetcher, overall: AbortSignal): Fetcher {
  return ((input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
    const timeout = AbortSignal.timeout(15_000);
    const existingSignal = (init as { signal?: AbortSignal } | undefined)
      ?.signal;
    const signal = existingSignal
      ? AbortSignal.any([existingSignal, timeout, overall])
      : AbortSignal.any([timeout, overall]);
    return fetcher(input, { ...init, signal });
  }) as Fetcher;
}

export function easternReportingWeek(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const local = new Date(`${value.year}-${value.month}-${value.day}T00:00:00Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    value.weekday,
  );
  local.setUTCDate(local.getUTCDate() + (weekday === 0 ? 1 : 1 - weekday));
  return local.toISOString().slice(0, 10);
}

export async function handleStandUpGoogle(
  request: Request,
  dependencies: Dependencies = {},
): Promise<Response> {
  const env = dependencies.env ?? ((name) => Deno.env.get(name));
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  let cronSecret: string;
  try {
    cronSecret = required(env, "STAND_UP_GOOGLE_CRON_SECRET");
  } catch {
    return json({ error: "Hosted Stand Up bridge is not configured" }, 503);
  }
  if (!safeEqual(request.headers.get("x-cron-secret") ?? "", cronSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const fetcher = boundedFetcher(
    dependencies.fetcher ?? fetch,
    AbortSignal.timeout(45_000),
  );
  const now = dependencies.now?.() ?? new Date();
  const observedAt = now.toISOString();
  let workbookId = "", weekStart = "";
  let rpc: BridgeRpc | undefined = dependencies.rpc;
  try {
    workbookId = required(env, "STAND_UP_GOOGLE_WORKBOOK_ID");
    weekStart = easternReportingWeek(now);
    rpc ??= new SupabaseBridgeRpc(
      required(env, "SUPABASE_URL"),
      required(env, "SUPABASE_SERVICE_ROLE_KEY"),
      fetcher,
    );
    const context = await rpc.loadContext({
      workbook_id: workbookId,
      week_start: weekStart,
    });
    if (context.state === "disabled") {
      return json({ state: "disabled" }, 200);
    }
    const credentials = {
      clientId: required(env, "GOOGLE_CLIENT_ID"),
      clientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
      refreshToken: required(env, "GOOGLE_REFRESH_TOKEN"),
    };
    const fingerprint = await credentialFingerprint(credentials);
    if (
      context.google_connection?.state === "reconnect_required" &&
      context.google_connection.credential_fingerprint === fingerprint
    ) {
      return json({
        state: "reconnect_required",
        error: "Reconnect the dedicated Google workbook account",
      }, 503);
    }
    let tokenResult;
    try {
      tokenResult = await refreshGoogleAccessToken(credentials, fetcher);
    } catch (error) {
      if (error instanceof GoogleReconnectRequired) {
        await rpc.recordFailure({
          workbook_id: workbookId,
          week_start: weekStart,
          error_code: "google_auth_reconnect_required",
          observed_at: observedAt,
          detail: {
            reason: "credential_expired_or_revoked",
            credential_fingerprint: fingerprint,
          },
        });
        return json({
          state: "reconnect_required",
          error: "Reconnect the dedicated Google workbook account",
        }, 503);
      }
      throw error;
    }
    if (
      tokenResult.replacementRefreshToken &&
      tokenResult.replacementRefreshToken !== credentials.refreshToken
    ) {
      await rpc.recordFailure({
        workbook_id: workbookId,
        week_start: weekStart,
        error_code: "bridge_error",
        observed_at: observedAt,
        detail: { reason: "refresh_token_rotation_required" },
      });
      return json({
        state: "reconnect_required",
        error:
          "Google replaced the connector credential; rotate the hosted secret before retrying",
      }, 503);
    }
    const driveClient = new GoogleDriveClient(
      tokenResult.accessToken,
      fetcher,
    );
    const snapshot = await driveClient.downloadStable(workbookId);
    const parsed = await parseWorkbook(
      snapshot.bytes,
      context.facility_map,
      workbookId,
      "Stand Up.xlsx",
      [weekStart],
    );
    if (
      parsed.issues.length &&
      !retainUnchangedHeldOvertime(parsed, context.baselines)
    ) {
      await rpc.recordFailure({
        workbook_id: workbookId,
        week_start: weekStart,
        error_code: "workbook_mapping_required",
        observed_at: observedAt,
        detail: {
          issue_codes: [...new Set(parsed.issues.map((issue) => issue.code))],
        },
      });
      return json({
        state: "mapping_required",
        issue_count: parsed.issues.length,
      }, 409);
    }
    const expectedLocations = Object.keys(parsed.locations).filter((identity) =>
      identity.endsWith(`:${weekStart}`)
    );
    if (expectedLocations.length !== 5) {
      await rpc.recordFailure({
        workbook_id: workbookId,
        week_start: weekStart,
        error_code: "workbook_mapping_required",
        observed_at: observedAt,
        detail: { issue_codes: ["current_week_incomplete"] },
      });
      return json({ state: "mapping_required", issue_count: 1 }, 409);
    }
    const exportInput = {
      workbook_id: workbookId,
      week_start: weekStart,
      source_sha256: parsed.source_sha256,
      drive: driveReceipt(snapshot.metadata),
      observed_at: observedAt,
      records: parsed.records,
    };
    const exportPlan = await rpc.prepareExport(exportInput);
    if (exportPlan.state === "disabled") {
      return json({ state: "disabled" }, 200);
    }
    if (exportPlan.state === "review_required") {
      return json({ state: "review_required", code: exportPlan.code }, 409);
    }
    if (exportPlan.state === "export_applied") {
      await rpc.completeExport({
        ...exportInput,
        export_id: exportPlan.export_id,
      });
      return json({
        state: "synchronized",
        direction: "haven_to_google",
        recovered: true,
      }, 200);
    }
    if (exportPlan.state === "export_required") {
      const patched = await patchWorkbook(
        snapshot.bytes,
        parsed,
        exportPlan.updates,
      );
      try {
        await driveClient.uploadConditional(
          workbookId,
          patched,
          snapshot.metadata.etag,
        );
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 412) {
          await rpc.abandonExport({
            workbook_id: workbookId,
            week_start: weekStart,
            export_id: exportPlan.export_id,
            reason: "provider_rejected",
          });
          await rpc.recordFailure({
            workbook_id: workbookId,
            week_start: weekStart,
            error_code: "bridge_error",
            observed_at: observedAt,
            detail: { reason: "google_conditional_write_rejected" },
          });
          return json({
            state: "review_required",
            code: "google_write_conflict",
          }, 409);
        }
        throw error;
      }
      const readback = await driveClient.downloadStable(workbookId);
      const readbackParsed = await parseWorkbook(
        readback.bytes,
        context.facility_map,
        workbookId,
        "Stand Up.xlsx",
        [weekStart],
      );
      if (
        readbackParsed.issues.length ||
        Object.keys(readbackParsed.locations).filter((identity) =>
            identity.endsWith(`:${weekStart}`)
          ).length !== 5
      ) {
        await rpc.abandonExport({
          workbook_id: workbookId,
          week_start: weekStart,
          export_id: exportPlan.export_id,
          reason: "readback_mismatch",
        });
        throw new WorkbookError("Uploaded workbook readback differs");
      }
      await rpc.completeExport({
        workbook_id: workbookId,
        week_start: weekStart,
        export_id: exportPlan.export_id,
        source_sha256: readbackParsed.source_sha256,
        drive: driveReceipt(readback.metadata),
        observed_at: new Date().toISOString(),
        records: readbackParsed.records,
      });
      return json({
        state: "synchronized",
        direction: "haven_to_google",
        recovered: false,
      }, 200);
    }
    const receipt = await rpc.applySnapshot({
      workbook_id: workbookId,
      week_start: weekStart,
      schema_version: parsed.schema_version,
      source_sha256: parsed.source_sha256,
      drive: driveReceipt(snapshot.metadata),
      observed_at: observedAt,
      credential_fingerprint: fingerprint,
      records: parsed.records,
      locations: parsed.locations,
    });
    return json({
      state: receipt.state,
      run_id: receipt.run_id,
      review_count: receipt.review?.length ?? 0,
    }, receipt.state === "synchronized" ? 200 : 409);
  } catch (error) {
    if (rpc && workbookId && weekStart) {
      const errorCode = error instanceof WorkbookError
        ? "workbook_mapping_required"
        : error instanceof GoogleSnapshotUnstable
        ? "google_snapshot_unstable"
        : "bridge_error";
      try {
        await rpc.recordFailure({
          workbook_id: workbookId,
          week_start: weekStart,
          error_code: errorCode,
          observed_at: observedAt,
          detail: {},
        });
      } catch { /* retain the original failure boundary */ }
    }
    return json({
      state: "failed",
      error:
        "Hosted Stand Up synchronization failed; inspect durable run history before retrying",
    }, 503);
  }
}
