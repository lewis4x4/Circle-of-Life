"use client";

import { useEffect, useRef, useState } from "react";

import { md5OfBlob } from "@/lib/operations/md5";
import type {
  EvidenceRule,
  WorkspaceReceipt,
} from "@/lib/operations/workspace";
import { SaveStateNotice } from "../../_components/save-state-notice";

const BUTTON =
  "min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const FIELD =
  "min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground";
const MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 20 * 1024 * 1024;

type EvidenceReply = Record<string, unknown> & {
  evidence?: { id: string; state?: string; failure_reason?: string };
  upload?: { signedUrl?: string } | null;
  error?: string;
};
type Attempt = {
  file?: File;
  payload: Record<string, unknown>;
  prepareKey: string;
  uploadedKey: string;
  finalizeKey: string;
  step: "prepare" | "put" | "uploaded" | "finalize";
  evidenceId?: string;
  signedUrl?: string;
};

export type EvidencePanelProps = {
  receipt: WorkspaceReceipt;
  rules: EvidenceRule[];
  actorId: string;
  actorName: string | null;
  /** Stop new attachments while the row is reconciling a different command. */
  disabled?: boolean;
  onResult: (reply: Record<string, unknown>) => void;
};

/** Only the immutable receipt's applicable requirements can open this surface. */
export function EvidencePanel(props: EvidencePanelProps) {
  if (props.receipt.evidence_status_current !== "missing") return null;
  const pinned = Array.isArray(props.receipt.missing_evidence)
    ? props.receipt.missing_evidence
    : [];
  // Rules carry labels and kinds, not file paths. Prefer the receipt snapshot over current rules.
  const rules = pinned.filter((value): value is EvidenceRule =>
    Boolean(
      value &&
      typeof value === "object" &&
      typeof value.label === "string" &&
      typeof value.kind === "string",
    ),
  );
  if (rules.length === 0)
    return (
      <p role="alert">
        Evidence requirements could not be read. Refresh this receipt before
        attaching evidence.
      </p>
    );
  return (
    <section aria-label="Required evidence" className="space-y-3">
      <h4 className="font-medium">Required evidence</h4>
      {rules.map((rule) => (
        <EvidenceRuleForm
          key={`${props.actorId}:${props.receipt.id}:${rule.kind}:${rule.label}`}
          {...props}
          rule={rule}
        />
      ))}
    </section>
  );
}

function EvidenceRuleForm({
  receipt,
  actorId,
  actorName,
  onResult,
  rule,
  disabled = false,
}: EvidencePanelProps & { rule: EvidenceRule }) {
  const [file, setFile] = useState<File | null>(null);
  const [linkedTable, setLinkedTable] = useState("facility_documents");
  const [linkedId, setLinkedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const active = useRef(0);
  const lock = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const fileInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    active.current += 1;
    const controllers = requests.current;
    return () => {
      active.current += 1;
      attempt.current = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [actorId, receipt.id]);

  const supportedObject = ["document", "photo", "signature"].includes(
    rule.kind,
  );
  const linked = rule.kind === "linked_record";

  async function run() {
    if (lock.current || (disabled && !attempt.current)) return;
    const generation = active.current;
    const current = () => generation === active.current;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    let durableFailure = false;

    async function command(
      url: string,
      body: Record<string, unknown>,
    ): Promise<EvidenceReply> {
      const controller = new AbortController();
      requests.current.add(controller);
      const timer = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      let reply: EvidenceReply;
      try {
        response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        reply = (await response.json()) as EvidenceReply;
      } finally {
        clearTimeout(timer);
        requests.current.delete(controller);
      }
      if (!current()) throw new Error("Recording surface changed");
      if (reply.evidence?.state === "failed") {
        durableFailure = true;
        setFailed(true);
        throw new Error(
          reply.error ||
            reply.evidence.failure_reason ||
            "The server marked this evidence failed. Try another file.",
        );
      }
      if (!response.ok) {
        // Validation/authority/state refusals are decisions, not lost answers.
        // Permit replacement rather than trapping an invalid reference in a retry loop.
        if (
          response.status >= 400 &&
          response.status < 500 &&
          reply.outcome !== "uncertain"
        )
          setFailed(true);
        throw new Error(
          reply.error ||
            "Evidence could not be confirmed. Retry the same attachment.",
        );
      }
      return reply;
    }

    try {
      let held = attempt.current;
      if (!held) {
        let payload: Record<string, unknown>;
        if (linked) {
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              linkedId,
            )
          )
            throw new Error("Enter the linked record identifier.");
          payload = {
            kind: rule.kind,
            rule_label: rule.label,
            linked_table: linkedTable,
            linked_record_id: linkedId,
          };
        } else {
          if (!file) throw new Error("Choose a file first.");
          if (
            !MIME_TYPES.includes(file.type) ||
            file.size < 1 ||
            file.size > MAX_BYTES
          )
            throw new Error(
              "Choose a PDF, JPEG, PNG or WebP file up to 20 MB.",
            );
          setMessage("Checking file checksum…");
          const md5 = await md5OfBlob(file);
          if (!current()) return;
          const filename =
            file.name
              .replace(/[^A-Za-z0-9._-]/g, "_")
              .replace(/^[^A-Za-z0-9]+/, "")
              .slice(0, 120) || "evidence";
          payload = {
            kind: rule.kind,
            rule_label: rule.label,
            filename,
            mime: file.type,
            size_bytes: file.size,
            md5,
          };
        }
        held = {
          ...(file ? { file } : {}),
          payload,
          step: "prepare",
          prepareKey: crypto.randomUUID(),
          uploadedKey: crypto.randomUUID(),
          finalizeKey: crypto.randomUUID(),
        };
        attempt.current = held;
      }
      if (held.step === "prepare") {
        setMessage("Preparing evidence…");
        const prepared = await command("/api/admin/operations/evidence", {
          receipt_id: receipt.id,
          request_key: held.prepareKey,
          payload: held.payload,
        });
        if (!prepared.evidence?.id)
          throw new Error(
            "Evidence preparation was not confirmed. Retry the same attachment.",
          );
        held.evidenceId = prepared.evidence.id;
        if (prepared.evidence.state === "finalized") {
          onResult(prepared);
          setConfirmed(true);
          setMessage("Evidence finalized by the server.");
          attempt.current = null;
          return;
        }
        if (prepared.evidence.state === "uploaded") held.step = "finalize";
        else {
          if (!prepared.upload?.signedUrl)
            throw new Error(
              "Upload URL unavailable. Retry the same attachment.",
            );
          held.signedUrl = prepared.upload.signedUrl;
          held.step = "put";
        }
      }
      if (held.step === "put") {
        setMessage("Uploading evidence…");
        if (!held.file || !held.signedUrl)
          throw new Error("Choose the file again to continue.");
        // A lost PUT answer may still have stored the bytes. The uploaded command verifies them.
        const controller = new AbortController();
        requests.current.add(controller);
        const timer = setTimeout(() => controller.abort(), 60_000);
        try {
          await fetch(held.signedUrl, {
            method: "PUT",
            body: held.file,
            signal: controller.signal,
            headers: { "content-type": held.file.type },
            credentials: "omit",
          });
        } catch {
          if (!current()) return;
        } finally {
          clearTimeout(timer);
          requests.current.delete(controller);
        }
        if (!current()) return;
        held.signedUrl = undefined;
        held.step = "uploaded";
      }
      if (held.step === "uploaded") {
        setMessage("Verifying uploaded bytes…");
        try {
          const uploaded = await command(
            `/api/admin/operations/evidence/${held.evidenceId}/uploaded`,
            { request_key: held.uploadedKey },
          );
          if (
            uploaded.evidence?.state !== "uploaded" &&
            uploaded.evidence?.state !== "finalized"
          )
            throw new Error("Upload verification was not confirmed.");
          held.step = "finalize";
        } catch (error) {
          // Re-preparing with the same key gives the same evidence and a fresh signed URL.
          // No new attachment is created, including when the prior upload answer was lost.
          if (!durableFailure) held.step = "prepare";
          throw error;
        }
      }
      if (held.step === "finalize") {
        if (typeof receipt.revision !== "string")
          throw new Error(
            "Receipt revision unavailable. Refresh this receipt before finalizing.",
          );
        setMessage("Finalizing evidence…");
        const finalized = await command(
          `/api/admin/operations/evidence/${held.evidenceId}/finalize`,
          {
            request_key: held.finalizeKey,
            expected_receipt_revision: receipt.revision,
          },
        );
        if (finalized.evidence?.state !== "finalized")
          throw new Error("Evidence finalization was not confirmed.");
        onResult(finalized);
        setConfirmed(true);
        setMessage("Evidence finalized by the server.");
        attempt.current = null;
      }
    } catch (error) {
      if (current())
        setMessage(
          error instanceof Error
            ? error.message
            : "Evidence could not be confirmed.",
        );
    } finally {
      if (current()) {
        lock.current = false;
        setBusy(false);
        submitButton.current?.focus({ preventScroll: true });
      }
    }
  }

  function another() {
    if (disabled) return;
    attempt.current = null;
    setFailed(false);
    setConfirmed(false);
    setFile(null);
    setLinkedId("");
    setMessage(null);
    if (fileInput.current) {
      fileInput.current.value = "";
      fileInput.current.focus({ preventScroll: true });
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">
        {rule.label} · {rule.min_count} required
      </p>
      <SaveStateNotice
        state={{ kind: "idle" }}
        actorName={actorName}
        uploading={busy}
        className="[&_button]:min-h-11"
      />
      {!supportedObject && !linked ? (
        <p role="alert">
          This evidence type is not supported by the attachment service. The
          requirement remains unmet; report an issue for help.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!failed && !confirmed) void run();
          }}
          className="space-y-2"
        >
          <fieldset
            disabled={
              disabled ||
              busy ||
              failed ||
              Boolean(attempt.current) ||
              confirmed
            }
            className="space-y-2"
          >
            {linked ? (
              <>
                <label className="block text-sm">
                  Record source
                  <select
                    className={FIELD}
                    value={linkedTable}
                    onChange={(event) => setLinkedTable(event.target.value)}
                  >
                    <option value="facility_documents">
                      Facility document
                    </option>
                    <option value="employee_file_records">Employee file</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Record identifier
                  <input
                    className={FIELD}
                    value={linkedId}
                    onChange={(event) => setLinkedId(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <label className="block text-sm">
                File for {rule.label}
                <input
                  ref={fileInput}
                  className={FIELD}
                  type="file"
                  accept={MIME_TYPES.join(",")}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </fieldset>
          <button
            ref={submitButton}
            type="submit"
            className={BUTTON}
            disabled={busy || (disabled && !attempt.current)}
            aria-disabled={failed || confirmed}
          >
            {confirmed
              ? "Evidence finalized"
              : attempt.current
                ? "Retry the same attachment"
                : linked
                  ? "Attach record"
                  : "Upload evidence"}
          </button>
          {failed || confirmed ? (
            <button
              type="button"
              className={BUTTON}
              disabled={disabled}
              onClick={another}
            >
              {failed
                ? linked
                  ? "Try another record"
                  : "Try another file"
                : "Attach another"}
            </button>
          ) : null}
        </form>
      )}
      {message ? (
        <p
          role={failed ? "alert" : "status"}
          aria-live="polite"
          className="text-sm"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
