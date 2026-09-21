"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-label";
import { createClient } from "@/lib/supabase/client";
import {
  BENEFITS_BUCKET,
  BENEFITS_MAX_FILE_BYTES,
  type BenefitsDetail,
  type BenefitsDocument,
} from "@/lib/benefits/contracts";
import {
  BenefitsRequestError,
  benefitsFetch,
  dateLabel,
  ErrorNotice,
  Panel,
} from "./benefits-ui";

type UploadReservation = {
  document: BenefitsDocument;
  revision: number;
  upload: { signedUrl: string; token: string; path: string } | null;
};
export function BenefitsDocuments({
  detail,
  refresh,
  disabled,
}: {
  detail: BenefitsDetail;
  refresh: () => Promise<void>;
  disabled: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const upload = useRef<{
    file: File;
    requestId: string;
    finalizeId: string;
    reservation?: UploadReservation;
    uploaded?: boolean;
    documentType: string;
    version: string;
  } | null>(null);
  const base = `/api/admin/benefits/cases/${detail.case.id}/documents`;
  return (
    <Panel
      title="Private evidence"
      description="Upload actual documents and signed returns. AHCA 3008 is separate from admission Form 1823. A signature image alone does not establish authority or valid consent."
    >
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!file || busy || disabled) return;
          setBusy(true);
          setError(null);
          setSuccess(false);
          try {
            if (
              file.size > BENEFITS_MAX_FILE_BYTES ||
              !["application/pdf", "image/png", "image/jpeg"].includes(
                file.type,
              )
            )
              throw new Error(
                "Choose a PDF, PNG, or JPEG no larger than 15 MiB.",
              );
            if (!upload.current || upload.current.file !== file)
              upload.current = {
                file,
                requestId: crypto.randomUUID(),
                finalizeId: crypto.randomUUID(),
                documentType,
                version,
              };
            const attempt = upload.current;
            if (!attempt.reservation) {
              const bytes = await file.arrayBuffer();
              const digest = await crypto.subtle.digest("SHA-256", bytes);
              const sha256 = Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join("");
              attempt.reservation = await benefitsFetch<UploadReservation>(
                base,
                {
                  method: "POST",
                  body: JSON.stringify({
                    filename: file.name,
                    mime_type: file.type,
                    size_bytes: file.size,
                    sha256,
                    document_type: attempt.documentType,
                    template_version: attempt.version || null,
                    expected_revision: detail.case.revision,
                    request_id: attempt.requestId,
                  }),
                },
              );
            }
            if (
              !attempt.reservation.upload &&
              attempt.reservation.document.status === "ready"
            ) {
              attempt.uploaded = true;
            } else if (!attempt.uploaded) {
              const reservation = attempt.reservation;
              const result = await createClient()
                .storage.from(BENEFITS_BUCKET)
                .uploadToSignedUrl(
                  reservation.upload!.path,
                  reservation.upload!.token,
                  file,
                  {
                    contentType: file.type,
                    metadata: { sha256: reservation.document.sha256 },
                  },
                );
              if (result.error) {
                // A prior request may have reached storage even if the browser lost the response. Finalization verifies the immutable bytes.
                await benefitsFetch(
                  `${base}/${reservation.document.id}/finalize`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      expected_revision: reservation.revision,
                      request_id: attempt.finalizeId,
                    }),
                  },
                );
                attempt.uploaded = true;
              } else {
                attempt.uploaded = true;
                await benefitsFetch(
                  `${base}/${reservation.document.id}/finalize`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      expected_revision: reservation.revision,
                      request_id: attempt.finalizeId,
                    }),
                  },
                );
              }
            } else
              await benefitsFetch(
                `${base}/${attempt.reservation.document.id}/finalize`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    expected_revision: attempt.reservation.revision,
                    request_id: attempt.finalizeId,
                  }),
                },
              );
            upload.current = null;
            setFile(null);
            if (fileInput.current) fileInput.current.value = "";
            setSuccess(true);
            await refresh();
          } catch (caught) {
            if (
              caught instanceof BenefitsRequestError &&
              caught.status === 409 &&
              upload.current
            ) {
              upload.current.finalizeId = crypto.randomUUID();
              if (upload.current.reservation) {
                try {
                  const latest = await benefitsFetch<BenefitsDetail>(
                    `/api/admin/benefits/cases/${detail.case.id}`,
                  );
                  upload.current.reservation.revision = latest.case.revision;
                } catch {
                  /* Keep the original draft and conflict; the user can refresh and retry. */
                }
              } else upload.current.requestId = crypto.randomUUID();
              await refresh();
            }
            setError(
              caught instanceof Error
                ? caught.message
                : "Upload could not be verified. Your file selection is preserved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy || disabled} className="space-y-4">
          <div className="space-y-2">
            <FormLabel htmlFor="benefits-evidence-file" required>
              Evidence file
            </FormLabel>
            <Input
              ref={fileInput}
              id="benefits-evidence-file"
              type="file"
              className="min-h-11"
              accept="application/pdf,image/jpeg,image/png"
              disabled={busy || disabled}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                upload.current = null;
                setSuccess(false);
              }}
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                Selected: {file.name}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <FormLabel htmlFor="benefits-document-type" required>
                Document description
              </FormLabel>
              <Input
                id="benefits-document-type"
                className="min-h-11"
                required
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                placeholder="For example: AHCA 3008 signed certification"
              />
            </div>
            <div className="space-y-2">
              <FormLabel htmlFor="benefits-template-version">
                Form or template version
              </FormLabel>
              <Input
                id="benefits-template-version"
                className="min-h-11"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="As printed on the original, if applicable"
              />
            </div>
          </div>
        </fieldset>
        <ErrorNotice error={error} />
        {success && (
          <p role="status">
            Evidence uploaded and verified. Review the relevant requirement
            before accepting it.
          </p>
        )}
        <Button
          className="min-h-11"
          type="submit"
          disabled={disabled || busy || !file}
        >
          {busy
            ? "Verifying upload…"
            : upload.current
              ? "Retry evidence upload"
              : "Upload private evidence"}
        </Button>
      </form>
      <ul className="divide-y divide-border">
        {detail.documents.map((document) => (
          <li key={document.id} className="space-y-1 py-3">
            <p className="break-words font-medium">{document.filename}</p>
            <p className="text-sm text-muted-foreground">
              {document.document_type} ·{" "}
              {document.template_version || "Version not recorded"} · Uploaded{" "}
              {dateLabel(document.created_at)}
            </p>
            {document.status === "ready" ? (
              <a
                className="inline-flex min-h-11 items-center text-sm underline"
                href={`${base}/${document.id}`}
                download
              >
                Download {document.filename}
              </a>
            ) : (
              <p className="text-sm">
                Upload reserved; verification pending. Retry the original upload
                to complete it.
              </p>
            )}
          </li>
        ))}
      </ul>
      {detail.documents.length === 0 && (
        <p className="text-sm text-muted-foreground">No evidence uploaded.</p>
      )}
    </Panel>
  );
}
