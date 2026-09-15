import {
  normalizeResidentIntakeSnapshot,
  type ResidentIntakeSnapshot,
} from "./types";

type ApiRecord = Record<string, unknown> & { error?: string; message?: string };

export async function readApiRecord(response: Response): Promise<ApiRecord> {
  const payload = (await response.json().catch(() => ({}))) as ApiRecord;
  if (!response.ok) {
    throw new Error(
      payload.error || payload.message || "The packet could not be updated. Refresh and try again.",
    );
  }
  return payload;
}

export async function loadResidentIntake(intakeId: string, signal?: AbortSignal): Promise<ResidentIntakeSnapshot> {
  const response = await fetch(`/api/admin/resident-record-intakes/${encodeURIComponent(intakeId)}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  return normalizeResidentIntakeSnapshot(await readApiRecord(response));
}

export async function sendResidentIntakeCommand(
  intake: ResidentIntakeSnapshot,
  command: string,
  payload: Record<string, unknown>,
  requestKey = crypto.randomUUID(),
): Promise<ApiRecord> {
  const response = await fetch(`/api/admin/resident-record-intakes/${encodeURIComponent(intake.id)}/commands`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command,
      request_key: requestKey,
      expected_revision: intake.revision,
      payload,
    }),
  });
  return readApiRecord(response);
}

export async function requestResidentIntakeParse(
  intake: ResidentIntakeSnapshot,
  sourceId: string,
  requestKey = crypto.randomUUID(),
): Promise<ApiRecord> {
  const response = await fetch(`/api/admin/resident-record-intakes/${encodeURIComponent(intake.id)}/parse`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source_id: sourceId,
      request_key: requestKey,
      expected_revision: intake.revision,
    }),
  });
  return readApiRecord(response);
}

