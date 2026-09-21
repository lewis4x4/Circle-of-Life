"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { createClient } from "@/lib/supabase/client";
import { BENEFITS_BUCKET, BENEFITS_MAX_FILE_BYTES } from "@/lib/benefits/contracts";
import type { FamilyBenefitsRequest } from "@/lib/benefits/family-server";
import { benefitsFetch, BenefitsRequestError, ErrorNotice, Panel, dateLabel } from "./benefits-ui";

type Reservation = { revision: number; document: { id: string; status: "reserved" | "ready" }; upload: { path: string; token: string } | null };
function RequestedUpload({ item, reload }: { item: FamilyBenefitsRequest; reload: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ file: File; requestId: string; finalizeId: string; revision: number; reservation?: Reservation } | null>(null);
  const base = `/api/family/benefits/requests/${item.id}/documents`;
  const send = async () => {
    if (!file || busy) return; setBusy(true); setError(null);
    try {
      if (file.size > BENEFITS_MAX_FILE_BYTES || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose a PDF, PNG or JPEG up to 15 MiB.");
      if (!attempt.current || attempt.current.file !== file) attempt.current = { file, requestId: crypto.randomUUID(), finalizeId: crypto.randomUUID(), revision: item.revision };
      const current = attempt.current;
      if (!current.reservation) {
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        current.reservation = await benefitsFetch<Reservation>(base, { method: "POST", body: JSON.stringify({ filename: file.name, mime_type: file.type, size_bytes: file.size, sha256, expected_revision: current.revision, request_id: current.requestId, ...(item.upload?.status === "pending" ? { resume_document_id: item.upload.document_id } : {}) }) });
        current.revision = current.reservation.revision;
      }
      const reservation = current.reservation;
      if (reservation.upload) {
        // A retry may find that an earlier response was lost after storage accepted
        // the object. The server verifies the exact bytes before finalization.
        await createClient().storage.from(BENEFITS_BUCKET).uploadToSignedUrl(reservation.upload.path, reservation.upload.token, file, { contentType: file.type });
      }
      await benefitsFetch(`${base}/${reservation.document.id}/finalize`, { method: "POST", body: JSON.stringify({ expected_revision: current.revision, request_id: current.finalizeId }) });
      attempt.current = null; setFile(null); await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Your selected file is still available to retry.");
      if (e instanceof BenefitsRequestError && e.status === 409) {
        // A failed transaction stores no replay result. Refresh revision for the
        // next click while preserving the exact reserved file.
        await reload();
        if (attempt.current) { attempt.current.finalizeId = crypto.randomUUID(); attempt.current.revision = -1; }
      }
    } finally { setBusy(false); }
  };
  useEffect(() => { if (attempt.current?.revision === -1) { attempt.current.revision = item.revision; if (!attempt.current.reservation) attempt.current.requestId = crypto.randomUUID(); } }, [item.revision]);
  return <Panel title={item.title} description={`${item.resident_name} · ${item.due_date ? `Due ${dateLabel(item.due_date)}` : "No due date specified"} · Access expires ${dateLabel(item.expires_at)}`}>
    {error && <ErrorNotice error={error} />}
    {item.upload?.status === "received" ? <p role="status">Received: {item.upload.filename}. Staff will review the document.</p> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {item.requires_signature && <p className="text-sm text-muted-foreground">Upload the actual completed and signed document requested by staff. Uploading does not verify the signature or establish eligibility.</p>}
      {item.upload?.status === "pending" && <p className="text-sm text-muted-foreground">An upload is pending. Select the same original file, {item.upload.filename}, to resume. Contact staff if you need to replace it.</p>}
      <p className="text-sm">Requested document (PDF, PNG or JPEG, up to 15 MiB)</p>
      <FileInput browseLabel={`Choose file for ${item.title}`} value={file ? [file] : []} accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={(files) => setFile(files[0] || null)} />
      <Button type="submit" disabled={busy || !file} className="min-h-11">{busy ? "Verifying upload…" : "Upload document"}</Button>
    </form>}
  </Panel>;
}
export function BenefitsFamilyCollection() {
  const [items, setItems] = useState<FamilyBenefitsRequest[] | null>(null), [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { const data = await benefitsFetch<{ requests: FamilyBenefitsRequest[] }>("/api/family/benefits"); setItems(data.requests); setError(null); } catch (e) { setItems(null); setError(e instanceof Error ? e.message : "Document requests could not be loaded."); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="space-y-5">{error && <><ErrorNotice error={error} /><Button variant="outline" className="min-h-11" onClick={() => void load()}>Retry</Button></>}{!items && !error && <p role="status">Loading your document requests…</p>}{items?.length === 0 && <Panel title="No active document requests" description="Staff will assign a request here when they need a document from you. Only requests assigned to your account appear.">{null}</Panel>}{items?.map((item) => <RequestedUpload key={item.id} item={item} reload={load} />)}</div>;
}
