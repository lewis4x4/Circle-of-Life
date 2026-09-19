"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileText, ImageIcon, Loader2, Paperclip } from "lucide-react";

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_KINDS,
  ATTACHMENT_MAX_PER_INCIDENT,
  attachmentKindLabel,
  describeAttachmentError,
  describeAttachmentRejection,
  fetchCareEventAttachments,
  signAttachment,
  uploadCareEventAttachment,
  type AttachmentKind,
  type CareEventAttachment,
} from "@/lib/care-events/attachments";
import { formatClockTime } from "@/lib/care-events/admin-copy";
import type { Database } from "@/types/database";

import { TapButton } from "./TapButton";

export type CareEventAttachmentsProps = {
  supabase: SupabaseClient<Database>;
  careEventId: string;
  organizationId: string;
  facilityId: string;
  timeZone: string;
  /** Hide the kind picker where only a photograph makes sense (the caregiver receipt). */
  kinds?: readonly AttachmentKind[];
  canUpload: boolean;
};

/**
 * The attachment list and its one upload control, shared by the caregiver
 * receipt and the Administrator's completion form (spec 07A §2, Appendix A).
 *
 * Files open through a five-minute signed URL. Nothing here builds a public
 * URL, and no signed URL is held past the click that made it.
 */
export function CareEventAttachments({
  supabase,
  careEventId,
  organizationId,
  facilityId,
  timeZone,
  kinds,
  canUpload,
}: CareEventAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<CareEventAttachment[] | null>(null);
  const [kind, setKind] = useState<AttachmentKind>(kinds?.[0] ?? "photo");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choices = useMemo(
    () => (kinds ? ATTACHMENT_KINDS.filter((option) => kinds.includes(option.value)) : ATTACHMENT_KINDS),
    [kinds],
  );

  const load = useCallback(async () => {
    try {
      setRows(await fetchCareEventAttachments(supabase, careEventId));
    } catch {
      setRows([]);
    }
  }, [supabase, careEventId]);

  // The first read subscribes to one request rather than syncing state into the
  // effect body: the rows land in the promise callback, and an unmount or a
  // change of care event drops the answer instead of letting a slow earlier
  // request overwrite a newer list.
  useEffect(() => {
    let current = true;
    fetchCareEventAttachments(supabase, careEventId)
      .then((next) => {
        if (current) setRows(next);
      })
      .catch(() => {
        if (current) setRows([]);
      });
    return () => {
      current = false;
    };
  }, [supabase, careEventId]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    const rejection = describeAttachmentRejection(file, rows?.length ?? 0);
    if (rejection) {
      setError(rejection);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      await uploadCareEventAttachment(supabase, { organizationId, facilityId, careEventId, file, kind });
      await load();
    } catch (caught) {
      setError(describeAttachmentError(caught));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function open(row: CareEventAttachment) {
    setError(null);
    setOpening(row.id);
    const url = await signAttachment(supabase, row.path);
    setOpening(null);
    if (!url) {
      setError("That file could not be opened. Try again.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const full = (rows?.length ?? 0) >= ATTACHMENT_MAX_PER_INCIDENT;

  return (
    <div className="space-y-3">
      {rows === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading files
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              {/* Named for the screen reader, and so the list never collides
                  with the kind picker below it, which uses the same words. */}
              <button
                type="button"
                aria-label={`Open the ${attachmentKindLabel(row.kind).toLowerCase()} added by ${row.takenByName ?? "an unknown user"}`}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={opening === row.id}
                onClick={() => void open(row)}
              >
                {opening === row.id ? (
                  <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : row.path.endsWith(".pdf") ? (
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{attachmentKindLabel(row.kind)}</span>
                  <span className="block text-sm text-muted-foreground">
                    {row.takenByName ?? "Unknown"}
                    {row.takenAt ? ` · ${formatClockTime(row.takenAt, timeZone) ?? ""}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div className="space-y-2">
          {choices.length > 1 ? (
            <div role="group" aria-label="What is this file?" className="flex flex-wrap gap-2">
              {choices.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={kind === option.value}
                  disabled={busy}
                  onClick={() => setKind(option.value)}
                  className={
                    kind === option.value
                      ? "rounded-lg border border-primary bg-primary/15 px-3 py-2 text-sm font-medium text-foreground"
                      : "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted/40"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            aria-label="Choose a photo or PDF"
            tabIndex={-1}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <TapButton
            className="justify-start gap-3"
            disabled={busy || full}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Paperclip className="size-5" aria-hidden />
            )}
            <span>{busy ? "Uploading" : full ? "Ten files is the limit" : "Add a photo or PDF"}</span>
          </TapButton>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
