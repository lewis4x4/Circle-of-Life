"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Upload, X } from "lucide-react";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const COMPLIANCE_CATEGORIES = [
  { value: "ahca_tag_220", label: "Personal Care" },
  { value: "ahca_tag_417", label: "Adequate Care" },
  { value: "ahca_tag_502", label: "Infection Control" },
  { value: "ahca_tag_309", label: "Staffing" },
  { value: "ahca_tag_314", label: "Staff Training" },
  { value: "ahca_tag_325", label: "Background Screening" },
  { value: "ahca_tag_404", label: "Resident Assessment" },
  { value: "ahca_tag_409", label: "Care Plan Updates" },
  { value: "ahca_tag_501", label: "Medication Admin" },
  { value: "ahca_tag_504", label: "Medication Errors" },
  { value: "ahca_tag_601", label: "Physical Plant" },
  { value: "ahca_tag_602", label: "Emergency Prep" },
  { value: "ahca_tag_701", label: "Dietary" },
  { value: "facility_policy", label: "Facility Policy" },
  { value: "resident_rights", label: "Resident Rights" },
  { value: "sop", label: "Standard Operating Procedure" },
  { value: "policy", label: "Company Policy" },
  { value: "training_material", label: "Training Material" },
  { value: "regulation", label: "AHCA Regulation" },
] as const;

type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number]["value"];

interface UploadDocumentModalProps {
  open: boolean;
  onClose: () => void;
  facilityId: string;
  organizationId: string;
}

export function UploadDocumentModal({
  open,
  onClose,
  facilityId,
  organizationId,
}: UploadDocumentModalProps) {
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ComplianceCategory>(COMPLIANCE_CATEGORIES[0].value);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUploading(false);
      setTitle("");
      setCategory(COMPLIANCE_CATEGORIES[0].value);
      setSelectedFile(null);
      setError(null);
      setSuccessMessage(null);
    }
  }, [open]);

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!isValidFacilityIdForQuery(facilityId)) {
      setError("Invalid facility selection.");
      return;
    }

    if (!organizationId) {
      setError("Missing organization context.");
      return;
    }

    if (!selectedFile) {
      setError("Select a file before uploading.");
      return;
    }

    const trimmedTitle = title.trim() || selectedFile.name;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", trimmedTitle);
      formData.append("workspace_id", organizationId);
      formData.append("audience", "company_wide");
      formData.append("status", "pending_review");

      const response = await authorizedEdgeFetch(
        "ingest",
        {
          method: "POST",
          body: formData,
        },
        "KB Upload Auth Debug",
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        document_id?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Upload failed.");
      }

      setSuccessMessage(
        `Uploaded "${trimmedTitle}" for ${COMPLIANCE_CATEGORIES.find((item) => item.value === category)?.label ?? category}.`,
      );
      setSelectedFile(null);
      setTitle("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Upload Compliance Document</h2>
            <p className="mt-1 text-sm text-slate-500">
              Send a compliance document to the knowledge base using the secured ingest pipeline.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close upload dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form className="space-y-5" onSubmit={handleUpload}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="kb-doc-title">
              Document Title
            </label>
            <input
              id="kb-doc-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Leave blank to use the filename"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={uploading}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="kb-doc-category">
              Category
            </label>
            <select
              id="kb-doc-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as ComplianceCategory)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={uploading}
            >
              {COMPLIANCE_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="kb-doc-file">
              File
            </label>
            <input
              id="kb-doc-file"
              type="file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-2 file:font-medium hover:file:bg-slate-100"
              disabled={uploading}
            />
            {selectedFile && <p className="mt-2 text-sm text-slate-500">{selectedFile.name}</p>}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading..." : "Upload Document"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
