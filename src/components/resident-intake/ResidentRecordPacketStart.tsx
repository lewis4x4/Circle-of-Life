"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FileCheck2, FileUp, Loader2, RotateCcw, ShieldAlert, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { loadResidentIntake, readApiRecord } from "./api";
import { snapshotRevision } from "./types";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type QueuedFileState = "ready" | "checking" | "uploading" | "finalizing" | "complete" | "failed";

type QueuedFile = {
  id: string;
  file: File;
  mimeType: string;
  state: QueuedFileState;
  message: string | null;
  prepareKey: string;
  finalizeKey: string;
  sourceId: string | null;
};

type CreateReply = Record<string, unknown> & {
  id?: string;
  intake?: { id?: string; revision?: string };
  snapshot?: { id?: string; intake?: { id?: string; revision?: string }; revision?: string };
};

export type ResidentRecordPacketStartProps = {
  facilityId: string;
  facilityName?: string | null;
  residentId?: string | null;
  admissionCaseId?: string | null;
  existingIntakeId?: string | null;
  focusDocumentType?: string | null;
};

function inferredMime(file: File): string | null {
  if (SUPPORTED_MIME.has(file.type)) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return null;
}

function fileIssue(file: File): string | null {
  if (file.size < 1) return "This file is empty.";
  if (file.size > MAX_FILE_BYTES) return "This file is larger than 20 MB.";
  if (!inferredMime(file)) return "Choose a PDF, JPEG, PNG, WebP, HEIC, or HEIF file.";
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

async function sha256(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function intakeIdentity(reply: CreateReply): string | null {
  return reply.id ?? reply.intake?.id ?? reply.snapshot?.id ?? reply.snapshot?.intake?.id ?? null;
}

export function ResidentRecordPacketStart({
  facilityId,
  facilityName,
  residentId = null,
  admissionCaseId = null,
  existingIntakeId = null,
  focusDocumentType = null,
}: ResidentRecordPacketStartProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const lockRef = useRef(false);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [intakeId, setIntakeId] = useState<string | null>(existingIntakeId);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const completeCount = files.filter((item) => item.state === "complete").length;
  const failedCount = files.filter((item) => item.state === "failed").length;
  const readyCount = files.filter((item) => item.state === "ready" || item.state === "failed").length;
  const canStart = files.length > 0 && readyCount > 0 && !busy;

  const title = useMemo(() => {
    const place = facilityName?.trim();
    const base = place ? `${place} resident packet` : "Resident admission packet";
    return focusDocumentType ? `${base} · ${focusDocumentType.replaceAll("_", " ")}` : base;
  }, [facilityName, focusDocumentType]);

  function queue(selected: File[]) {
    setError(null);
    const next: QueuedFile[] = [];
    const issues: string[] = [];
    for (const file of selected) {
      const issue = fileIssue(file);
      if (issue) {
        issues.push(`${file.name}: ${issue}`);
        continue;
      }
      const mimeType = inferredMime(file);
      if (!mimeType) continue;
      next.push({
        id: crypto.randomUUID(),
        file,
        mimeType,
        state: "ready",
        message: null,
        prepareKey: crypto.randomUUID(),
        finalizeKey: crypto.randomUUID(),
        sourceId: null,
      });
    }
    setFiles((current) => {
      const existing = new Set(current.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
      return [
        ...current,
        ...next.filter((item) => !existing.has(`${item.file.name}:${item.file.size}:${item.file.lastModified}`)),
      ];
    });
    if (issues.length) setError(issues.join(" "));
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    queue(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    queue(Array.from(event.dataTransfer.files));
  }

  function updateFile(id: string, patch: Partial<QueuedFile>) {
    setFiles((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function createIntake(): Promise<{ id: string; revision: string }> {
    if (intakeId) {
      const current = await loadResidentIntake(intakeId);
      return { id: intakeId, revision: current.revision };
    }
    const requestKeyStorage = `haven:resident-packet:create:${facilityId}:${residentId ?? "unmatched"}:${admissionCaseId ?? "no-case"}:${existingIntakeId ?? "new"}`;
    const requestKey = sessionStorage.getItem(requestKeyStorage) ?? crypto.randomUUID();
    sessionStorage.setItem(requestKeyStorage, requestKey);
    const response = await fetch("/api/admin/resident-record-intakes", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        facility_id: facilityId,
        title,
        resident_id: residentId,
        admission_case_id: admissionCaseId,
        request_key: requestKey,
      }),
    });
    const reply = (await readApiRecord(response)) as CreateReply;
    const nextId = intakeIdentity(reply);
    if (!nextId) throw new Error("The packet workspace was created, but its identifier was not returned. Retry with the same files.");
    const nextRevision = snapshotRevision(reply, "");
    if (!nextRevision) throw new Error("The packet workspace did not return a current revision. Refresh before uploading documents.");
    setIntakeId(nextId);
    return { id: nextId, revision: nextRevision };
  }

  async function uploadOne(item: QueuedFile, target: { id: string; revision: string }) {
    updateFile(item.id, { state: "checking", message: "Checking file identity…" });
    const hash = await sha256(item.file);
    updateFile(item.id, { state: "uploading", message: "Preparing secure upload…" });
    const prepareResponse = await fetch(`/api/admin/resident-record-intakes/${encodeURIComponent(target.id)}/sources`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_key: item.prepareKey,
        expected_revision: target.revision,
        file_name: item.file.name,
        declared_mime: item.mimeType,
        declared_size_bytes: item.file.size,
        declared_sha256: hash,
      }),
    });
    const prepared = await readApiRecord(prepareResponse);
    const source = (prepared.source ?? {}) as Record<string, unknown>;
    const sourceId = typeof source.id === "string" ? source.id : item.sourceId;
    if (!sourceId) throw new Error("The secure upload could not be confirmed. Retry this file.");
    const upload = (prepared.upload ?? {}) as Record<string, unknown>;
    const signedUrl = typeof upload.signedUrl === "string" ? upload.signedUrl : null;
    const afterPrepare = await loadResidentIntake(target.id);
    target.revision = afterPrepare.revision;
    updateFile(item.id, { sourceId, state: "uploading", message: "Uploading document…" });

    if (signedUrl) {
      try {
        await fetch(signedUrl, {
          method: "PUT",
          body: item.file,
          headers: { "content-type": item.mimeType },
          credentials: "omit",
        });
      } catch {
        // Finalization verifies storage identity and safely resolves a lost PUT answer.
      }
    }

    updateFile(item.id, { state: "finalizing", message: "Verifying uploaded document…" });
    const finalizeResponse = await fetch(
      `/api/admin/resident-record-intakes/${encodeURIComponent(target.id)}/sources/${encodeURIComponent(sourceId)}/finalize`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_key: item.finalizeKey, expected_revision: target.revision }),
      },
    );
    await readApiRecord(finalizeResponse);
    const afterFinalize = await loadResidentIntake(target.id);
    target.revision = afterFinalize.revision;
    updateFile(item.id, { state: "complete", message: "Ready for review", sourceId });
  }

  async function start() {
    if (lockRef.current || !canStart) return;
    lockRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const target = await createIntake();
      const pending = files.filter((item) => item.state === "ready" || item.state === "failed");
      let failures = 0;
      for (const item of pending) {
        try {
          await uploadOne(item, target);
        } catch (cause) {
          failures += 1;
          updateFile(item.id, {
            state: "failed",
            message: cause instanceof Error ? cause.message : "This document could not be confirmed. Retry it.",
          });
        }
      }
      if (failures > 0) {
        setError(`${failures} document${failures === 1 ? "" : "s"} need another attempt. Successful documents are already saved.`);
        return;
      }
      sessionStorage.removeItem(
        `haven:resident-packet:create:${facilityId}:${residentId ?? "unmatched"}:${admissionCaseId ?? "no-case"}:${existingIntakeId ?? "new"}`,
      );
      setMessage("Packet uploaded. Opening the review workspace…");
      router.push(`/admin/admissions/intake/${target.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The packet could not be started. Retry the same documents.");
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="packet-start-title" className="space-y-5">
      <div className="space-y-1">
        <h2 id="packet-start-title" className="text-[14px] font-semibold text-foreground">Upload a resident packet</h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {focusDocumentType
            ? `Add or replace ${focusDocumentType.replaceAll("_", " ")} here. Haven returns the file to this packet for classification and review.`
            : "Add all resident documents here. Haven keeps every original private, then asks an authorized reviewer to classify, match, approve, and apply each item."}
        </p>
      </div>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-5 py-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/15",
          busy && "opacity-70",
        )}
      >
        <FileUp className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-foreground">Drop the full packet here</p>
          <p className="mt-1 text-[12px] text-muted-foreground">PDF, JPEG, PNG, WebP, HEIC, or HEIF · 20 MB per file</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={onFileInput}
          disabled={busy}
          className="sr-only"
          aria-label="Resident packet documents"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          Choose documents
        </Button>
      </div>

      {files.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Documents selected for this packet">
          {files.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              {item.state === "complete" ? (
                <FileCheck2 className="size-4 shrink-0 text-success" aria-hidden />
              ) : item.state === "failed" ? (
                <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden />
              ) : busy && item.state !== "ready" ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{item.file.name}</p>
                <p className={cn("text-[11px] text-muted-foreground", item.state === "failed" && "text-destructive")}>
                  {item.message ?? formatBytes(item.file.size)}
                </p>
              </div>
              {item.state === "failed" ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => updateFile(item.id, { state: "ready", message: null })} disabled={busy}>
                  <RotateCcw className="mr-1 size-3.5" aria-hidden /> Retry
                </Button>
              ) : item.state === "ready" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))}
                  disabled={busy}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">{error}</p> : null}
      {message ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-success">{message}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[12px] text-muted-foreground">
          {files.length === 0
            ? "No documents selected"
            : `${files.length} selected · ${completeCount} confirmed${failedCount ? ` · ${failedCount} need retry` : ""}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {intakeId ? (
            <Link href={`/admin/admissions/intake/${intakeId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Open review workspace
            </Link>
          ) : null}
          <Button type="button" onClick={() => void start()} disabled={!canStart}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
            {intakeId ? "Retry pending documents" : "Start packet review"}
          </Button>
        </div>
      </div>
    </section>
  );
}
