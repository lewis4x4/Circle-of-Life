"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { AdminEmptyState, AdminErrorState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { RESIDENT_DOCUMENT_TYPES } from "@/components/resident-intake/ui-labels";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { enumLabel } from "@/lib/display/enum-label";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";

import { formatBytes } from "./upload";

export type ResidentDocument = {
  id: string;
  title: string;
  document_type: string | null;
  uploaded_at: string;
  file_type: string | null;
  file_size: number | null;
  expiration_date: string | null;
};

const TYPE_LABELS: Record<string, string> = Object.fromEntries(RESIDENT_DOCUMENT_TYPES);

export function residentDocumentTypeLabel(value: string | null): string {
  if (!value) return "Type not recorded";
  return TYPE_LABELS[value] ?? enumLabel(value);
}

const dateOnly = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function expirationLabel(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—";
  return dateOnly.format(new Date(`${value}T00:00:00Z`));
}

/** Current documents on one resident's record; each opens the original in a new tab. */
export function ResidentDocumentsList({ residentId }: { residentId: string }) {
  const [documents, setDocuments] = useState<ResidentDocument[] | null>(null);
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setError(null);
      setDocuments(null);
      try {
        const response = await fetch(`/api/admin/residents/${encodeURIComponent(residentId)}/documents`, { credentials: "same-origin", cache: "no-store", signal });
        const body = (await response.json().catch(() => null)) as { documents?: ResidentDocument[]; error?: string } | null;
        if (!response.ok) {
          setError({ message: body?.error ?? "Documents could not be loaded.", forbidden: response.status === 403 || response.status === 401 });
          return;
        }
        setDocuments([...(body?.documents ?? [])].sort((a, b) => Date.parse(b.uploaded_at) - Date.parse(a.uploaded_at)));
      } catch {
        if (!signal.aborted) setError({ message: "Documents could not be loaded.", forbidden: false });
      }
    },
    [residentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload]);

  if (error) {
    return error.forbidden ? (
      <AdminEmptyState title="You can’t see this resident’s documents" description="Your role or facility access does not include them." />
    ) : (
      <AdminErrorState message={error.message} onRetry={() => setReload((n) => n + 1)} />
    );
  }
  if (!documents) return <AdminTableLoadingState />;
  if (documents.length === 0) {
    return <AdminEmptyState title="No documents on file" description="Documents filed from Document Intake or the admission packet appear here." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table aria-label="Resident documents">
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Added (ET)</TableHead>
            <TableHead>Expires</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.id}>
              <TableCell>
                <a
                  href={`/api/admin/residents/${encodeURIComponent(residentId)}/documents/${encodeURIComponent(doc.id)}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {doc.title}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                {doc.file_size ? <span className="block text-xs text-muted-foreground">{formatBytes(doc.file_size)}</span> : null}
              </TableCell>
              <TableCell>{residentDocumentTypeLabel(doc.document_type)}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatFacilityTimestampEt(doc.uploaded_at)}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{expirationLabel(doc.expiration_date)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
