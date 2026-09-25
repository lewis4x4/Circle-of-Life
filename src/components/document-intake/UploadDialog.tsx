"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { CheckCircle2, Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormLabel } from "@/components/ui/form-label";
import { DOCUMENT_INTAKE_BUCKET } from "@/lib/document-intake/contracts";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { finalizeUpload, IntakeRequestError, prepareUpload } from "./api";
import { FIELD_CLASS } from "./IntakeDialogs";
import { formatBytes, intakeMime, sha256Hex, UPLOAD_ACCEPT, UPLOAD_LIMITS_COPY, uploadIssue } from "./upload";

type FileState = "ready" | "checking" | "uploading" | "finishing" | "done" | "failed" | "rejected";

type QueuedFile = {
  key: string;
  file: File;
  state: FileState;
  message: string | null;
  /** Kept across retries so a retry replays the same request. */
  prepareKey: string;
  finalizeKey: string;
  itemId: string | null;
  bytesSent: boolean;
  duplicateOf: string | null;
};

const STATE_COPY: Record<FileState, string> = {
  ready: "Ready",
  checking: "Checking the file…",
  uploading: "Uploading…",
  finishing: "Confirming…",
  done: "Received",
  failed: "Not uploaded",
  rejected: "Not accepted",
};

export function UploadDialog({
  open,
  onOpenChange,
  facilities,
  defaultFacilityId,
  maxBytes,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilities: Array<{ id: string; name: string }>;
  defaultFacilityId: string | null;
  maxBytes?: number;
  onUploaded: () => void;
}) {
  const facilityFieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [facilityId, setFacilityId] = useState("");
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFacilityId(defaultFacilityId && facilities.some((f) => f.id === defaultFacilityId) ? defaultFacilityId : "");
    } else {
      setFiles([]);
      setIssues([]);
    }
  }, [open, defaultFacilityId, facilities]);

  function queue(selected: File[]) {
    const nextIssues: string[] = [];
    const accepted: QueuedFile[] = [];
    for (const file of selected) {
      const issue = uploadIssue(file, maxBytes);
      if (issue) {
        nextIssues.push(`${file.name}: ${issue}`);
        continue;
      }
      accepted.push({
        key: crypto.randomUUID(),
        file,
        state: "ready",
        message: null,
        prepareKey: crypto.randomUUID(),
        finalizeKey: crypto.randomUUID(),
        itemId: null,
        bytesSent: false,
        duplicateOf: null,
      });
    }
    setIssues(nextIssues);
    setFiles((current) => {
      const seen = new Set(current.map((q) => `${q.file.name}:${q.file.size}:${q.file.lastModified}`));
      return [...current, ...accepted.filter((q) => !seen.has(`${q.file.name}:${q.file.size}:${q.file.lastModified}`))];
    });
  }

  function patch(key: string, next: Partial<QueuedFile>) {
    setFiles((current) => current.map((q) => (q.key === key ? { ...q, ...next } : q)));
  }

  async function uploadOne(entry: QueuedFile, facility: string) {
    const mime = intakeMime(entry.file);
    if (!mime) return;
    let itemId = entry.itemId;
    let sent = entry.bytesSent;
    try {
      if (!entry.bytesSent) {
        patch(entry.key, { state: "checking", message: null });
        const hash = await sha256Hex(await entry.file.arrayBuffer());
        patch(entry.key, { state: "uploading" });
        const prepared = await prepareUpload({
          request_key: entry.prepareKey,
          facility_id: facility,
          file_name: entry.file.name,
          declared_mime: mime,
          declared_size_bytes: entry.file.size,
          declared_sha256: hash,
        });
        itemId = prepared.item.id;
        patch(entry.key, { itemId });
        const { error } = await createClient()
          .storage.from(DOCUMENT_INTAKE_BUCKET)
          .uploadToSignedUrl(prepared.upload.path, prepared.upload.token, entry.file, { contentType: mime });
        if (error) throw new Error("The file did not upload. Try again.");
        sent = true;
        patch(entry.key, { bytesSent: true });
      }
      if (!itemId) throw new Error("The upload was not confirmed. Try again.");
      patch(entry.key, { state: "finishing" });
      const finalized = await finalizeUpload(itemId, entry.finalizeKey);
      if (finalized.item.status === "excluded") {
        // Bytes failed verification: the item is excluded (visible under All), not stuck in Processing.
        patch(entry.key, { state: "rejected", message: finalized.item.exclude_reason ?? "The file failed verification." });
        return;
      }
      patch(entry.key, { state: "done", duplicateOf: finalized.possible_duplicate_of, message: null });
    } catch (cause) {
      if (sent && cause instanceof IntakeRequestError && !cause.isRetryable) {
        // Finalize refused the bytes (for example, failed verification). Retrying would replay the same answer.
        patch(entry.key, { state: "rejected", message: cause.message });
        return;
      }
      patch(entry.key, { state: "failed", message: cause instanceof Error ? cause.message : "The file did not upload. Try again." });
    }
  }

  async function uploadAll() {
    if (!facilityId || busy) return;
    setBusy(true);
    const pending = files.filter((q) => q.state === "ready" || q.state === "failed");
    for (const entry of pending) await uploadOne(entry, facilityId);
    setBusy(false);
    onUploaded();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) queue(Array.from(event.dataTransfer.files));
  }

  const waiting = files.filter((q) => q.state === "ready" || q.state === "failed").length;
  const done = files.filter((q) => q.state === "done").length;
  const facilityLocked = files.some((q) => q.itemId);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add documents</DialogTitle>
          <DialogDescription>{maxBytes && maxBytes < 20 * 1024 * 1024 ? UPLOAD_LIMITS_COPY.replace("20 MB", `${Math.floor(maxBytes / (1024 * 1024))} MB`) : UPLOAD_LIMITS_COPY} Each file is kept exactly as sent and waits for review.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <FormLabel htmlFor={facilityFieldId} required>
            Facility
          </FormLabel>
          <select
            id={facilityFieldId}
            className={FIELD_CLASS}
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            disabled={busy || facilityLocked}
            required
          >
            <option value="" disabled>
              No facility chosen
            </option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center",
            dragging ? "border-primary bg-muted" : "border-border bg-muted/20",
          )}
        >
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-foreground">Drop files here, or</p>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose files to add"
            onChange={(e) => {
              queue(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        {issues.length ? (
          <ul role="alert" className="space-y-1 text-sm text-destructive">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}

        {files.length ? (
          <ul className="grid gap-2" aria-label="Files to add">
            {files.map((q) => (
              <li key={q.key} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{q.file.name}</p>
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {formatBytes(q.file.size)} · {STATE_COPY[q.state]}
                  </p>
                  {q.message ? <p className="text-xs text-destructive">{q.message}</p> : null}
                  {q.duplicateOf ? (
                    <p className="text-xs text-foreground">
                      This may be a copy of a document already received.{" "}
                      <Link className="underline underline-offset-4" href={`/admin/document-intake/${q.duplicateOf}`}>
                        Open the earlier one
                      </Link>
                    </p>
                  ) : null}
                </div>
                {q.state === "done" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Received" />
                ) : q.state === "ready" && !busy ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${q.file.name}`} onClick={() => setFiles((current) => current.filter((c) => c.key !== q.key))}>
                    <X className="size-4" aria-hidden />
                  </Button>
                ) : q.state !== "failed" && q.state !== "ready" && q.state !== "rejected" ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {done > 0 && waiting === 0 ? "Done" : "Cancel"}
          </Button>
          <Button type="button" onClick={() => void uploadAll()} disabled={busy || !facilityId || waiting === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {files.some((q) => q.state === "failed") ? "Try again" : `Add ${waiting || ""} ${waiting === 1 ? "document" : "documents"}`.replace("  ", " ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
