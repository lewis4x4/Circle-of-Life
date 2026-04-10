"use client";

import { useState, useCallback, useEffect } from "react";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/admin/facilities/facility-constants";

interface DocumentEntry {
  id: string;
  facility_id: string;
  document_name: string;
  document_category: string;
  name: string;
  category: string;
  file_path: string;
  expiration_date: string | null;
  uploaded_at: string;
  uploaded_by: string;
}

interface DocumentsResponse {
  data: DocumentEntry[];
}

interface UseFacilityDocumentsReturn {
  documents: DocumentEntry[];
  isLoading: boolean;
  error: string | null;
  uploadDocument: (file: File, category: string, expirationDate?: string) => Promise<DocumentEntry | null>;
  isUploading: boolean;
  refetch: () => Promise<void>;
}

export function useFacilityDocuments(facilityId: string): UseFacilityDocumentsReturn {
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/documents`);
      if (!res.ok) {
        throw new Error("Failed to fetch documents");
      }
      const json = (await res.json()) as DocumentsResponse;
      setDocuments(
        (json.data ?? []).map((doc) => ({
          ...doc,
          name: (doc as DocumentEntry & { document_name?: string }).document_name ?? doc.name,
          category:
            DOCUMENT_CATEGORY_LABELS[
              ((doc as DocumentEntry & { document_category?: keyof typeof DOCUMENT_CATEGORY_LABELS })
                .document_category ?? doc.category) as keyof typeof DOCUMENT_CATEGORY_LABELS
            ] ?? ((doc as DocumentEntry & { document_category?: string }).document_category ?? doc.category),
          document_name: (doc as DocumentEntry & { document_name?: string }).document_name ?? doc.name,
          document_category:
            (doc as DocumentEntry & { document_category?: string }).document_category ?? doc.category,
        })),
      );
    } catch (err) {
      console.error("[useFacilityDocuments] fetch error:", err);
      const message = err instanceof Error ? err.message : "Failed to fetch documents";
      setError(message);
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  const uploadDocument = useCallback(
    async (file: File, category: string, expirationDate?: string): Promise<DocumentEntry | null> => {
      setIsUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append(
          "metadata",
          JSON.stringify({
            document_category: category,
            document_name: file.name,
            ...(expirationDate ? { expiration_date: expirationDate } : {}),
          }),
        );

        const res = await fetch(`/api/admin/facilities/${facilityId}/documents`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          throw new Error("Failed to upload document");
        }
        const json = (await res.json()) as { data: DocumentEntry };
        await refetch();
        if (!json.data) return null;
        return {
          ...json.data,
          name: (json.data as DocumentEntry & { document_name?: string }).document_name ?? json.data.name,
          category:
            DOCUMENT_CATEGORY_LABELS[
              ((json.data as DocumentEntry & { document_category?: keyof typeof DOCUMENT_CATEGORY_LABELS })
                .document_category ?? json.data.category) as keyof typeof DOCUMENT_CATEGORY_LABELS
            ] ??
            ((json.data as DocumentEntry & { document_category?: string }).document_category ?? json.data.category),
          document_name:
            (json.data as DocumentEntry & { document_name?: string }).document_name ?? json.data.name,
          document_category:
            (json.data as DocumentEntry & { document_category?: string }).document_category ?? json.data.category,
        };
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

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    documents,
    isLoading,
    error,
    uploadDocument,
    isUploading,
    refetch,
  };
}
