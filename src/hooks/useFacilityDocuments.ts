"use client";

import { useState, useCallback, useEffect } from "react";
import type { DocumentVaultCategoryKey } from "@/lib/admin/facilities/document-vault-taxonomy";

export interface FacilityDocumentHookRow {
  id: string;
  document_category: DocumentVaultCategoryKey | string;
  vault_series_id?: string | null;
  document_name: string;
  notes?: string | null;
  friendly_title?: string | null;
  carrier?: string | null;
  file_path: string;
  file_size_bytes?: number | null;
  mime_type?: string | null;
  expiration_date: string | null;
  uploaded_at: string;
  uploaded_by: string;
  uploaded_by_display?: string;
}

export interface DocumentUploadMeta {
  category: DocumentVaultCategoryKey | string;
  fileName?: string;
  expirationDate?: string;
  carrier?: string;
  friendlyTitle?: string;
  notes?: string;
  effectiveDate?: string;
  supersedesDocumentId?: string;
  vaultSeriesId?: string;
}

interface DocumentsResponse {
  data: FacilityDocumentHookRow[];
}

function normalize(doc: FacilityDocumentHookRow): FacilityDocumentHookRow {
  return {
    ...doc,
    uploaded_by_display: doc.uploaded_by_display ?? "Unknown",
  };
}

interface UseFacilityDocumentsReturn {
  documents: FacilityDocumentHookRow[];
  isLoading: boolean;
  error: string | null;
  uploadDocument: (
    file: File,
    category: string,
    expirationDate?: string,
  ) => Promise<FacilityDocumentHookRow | null>;
  uploadFile: (file: File, meta: DocumentUploadMeta) => Promise<FacilityDocumentHookRow | null>;
  archiveDocument: (documentId: string) => Promise<boolean>;
  fetchSignedUrl: (documentId: string) => Promise<string | null>;
  isUploading: boolean;
  refetch: () => Promise<void>;
  archivedScope: boolean;
  setArchivedScope: (next: boolean) => void;
}

export function useFacilityDocuments(
  facilityId: string,
  _options?: { archived?: boolean },
): UseFacilityDocumentsReturn {
  const [documents, setDocuments] = useState<FacilityDocumentHookRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivedScope, setArchivedScope] = useState(_options?.archived ?? false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const qs = archivedScope ? "?archived=1" : "";
      const res = await fetch(`/api/admin/facilities/${facilityId}/documents${qs}`);
      if (!res.ok) {
        throw new Error("Failed to fetch documents");
      }
      const json = (await res.json()) as DocumentsResponse;
      setDocuments((json.data ?? []).map(normalize));
    } catch (err) {
      console.error("[useFacilityDocuments] fetch error:", err);
      const message = err instanceof Error ? err.message : "Failed to fetch documents";
      setError(message);
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId, archivedScope]);

  const uploadFile = useCallback(
    async (file: File, meta: DocumentUploadMeta): Promise<FacilityDocumentHookRow | null> => {
      setIsUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append(
          "metadata",
          JSON.stringify({
            document_category: meta.category,
            document_name: meta.fileName ?? file.name,
            ...(meta.expirationDate ? { expiration_date: meta.expirationDate } : {}),
            ...(meta.carrier ? { carrier: meta.carrier } : {}),
            ...(meta.friendlyTitle ? { friendly_title: meta.friendlyTitle } : {}),
            ...(meta.notes ? { notes: meta.notes } : {}),
            ...(meta.effectiveDate ? { effective_date: meta.effectiveDate } : {}),
            ...(meta.supersedesDocumentId ? { supersedes_document_id: meta.supersedesDocumentId } : {}),
            ...(meta.vaultSeriesId ? { vault_series_id: meta.vaultSeriesId } : {}),
          }),
        );

        const res = await fetch(`/api/admin/facilities/${facilityId}/documents`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          throw new Error("Failed to upload document");
        }
        const json = (await res.json()) as { data: FacilityDocumentHookRow };
        await refetch();
        if (!json.data) return null;
        return normalize(json.data);
      } catch (err) {
        console.error("[useFacilityDocuments] upload error:", err);
        const message = err instanceof Error ? err.message : "Failed to upload document";
        setError(message);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [facilityId, refetch],
  );

  const uploadDocument = useCallback(
    async (file: File, category: string, expirationDate?: string): Promise<FacilityDocumentHookRow | null> => {
      return uploadFile(file, { category, expirationDate });
    },
    [uploadFile],
  );

  const archiveDocument = useCallback(
    async (documentId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/documents/${documentId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Archive failed");
        await refetch();
        return true;
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : "Archive failed");
        return false;
      }
    },
    [facilityId, refetch],
  );

  const fetchSignedUrl = useCallback(
    async (documentId: string): Promise<string | null> => {
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/documents/${documentId}/signed-url`);
        if (!res.ok) return null;
        const j = (await res.json()) as { signedUrl?: string };
        return j.signedUrl ?? null;
      } catch {
        return null;
      }
    },
    [facilityId],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    documents,
    isLoading,
    error,
    uploadDocument,
    uploadFile,
    archiveDocument,
    fetchSignedUrl,
    isUploading,
    refetch,
    archivedScope,
    setArchivedScope,
  };
}
