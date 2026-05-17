"use client";

import React, { useState, useRef } from "react";
import { Loader2, Upload, FileText, Trash2 } from "lucide-react";
import { useFacilityDocuments } from "@/hooks/useFacilityDocuments";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/lib/admin/facilities/facility-constants";
import { ExpirationBadge } from "../shared/ExpirationBadge";
import { RecordDetailSection } from "@/design-system/components/record-detail";

interface DocumentsTabProps {
  facilityId: string;
}

const inputCls = "w-full px-3 py-2 rounded-[8px] border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function DocumentsTab({ facilityId }: DocumentsTabProps) {
  const { documents, isLoading, error, uploadDocument, isUploading } = useFacilityDocuments(facilityId);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !selectedCategory) {
      alert("Please select a file and category");
      return;
    }
    const result = await uploadDocument(selectedFile, selectedCategory, expirationDate);
    if (result) {
      setSelectedFile(null);
      setSelectedCategory("");
      setExpirationDate("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const filteredDocuments = categoryFilter
    ? documents.filter((doc) => doc.category === categoryFilter)
    : documents;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RecordDetailSection
        title="Upload document"
        action={<Upload className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Select file</label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:px-3 file:py-2 file:border file:border-border file:rounded-[8px] file:text-sm file:font-medium file:bg-muted/10 file:text-foreground hover:file:bg-muted/20"
            />
            {selectedFile && <p className="mt-2 text-sm text-foreground">{selectedFile.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className={inputCls}
            >
              <option value="">Select category…</option>
              {DOCUMENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {DOCUMENT_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Expiration date (optional)</label>
            <input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className={inputCls}
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={() => void handleUpload()}
              disabled={!selectedFile || !selectedCategory || isUploading}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-[8px] disabled:opacity-50 font-medium text-sm"
            >
              {isUploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </RecordDetailSection>

      {documents.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setCategoryFilter("")}
            className={`px-3 py-1 rounded-[8px] text-sm font-medium transition-colors whitespace-nowrap ${
              categoryFilter === ""
                ? "bg-primary/10 border border-primary/30 text-primary"
                : "bg-muted/10 border border-border text-muted-foreground hover:bg-muted/20"
            }`}
          >
            All
          </button>
          {Array.from(new Set(documents.map((d) => d.category))).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-[8px] text-sm font-medium transition-colors whitespace-nowrap ${
                categoryFilter === cat
                  ? "bg-primary/10 border border-primary/30 text-primary"
                  : "bg-muted/10 border border-border text-muted-foreground hover:bg-muted/20"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {filteredDocuments.length === 0 ? (
        <div className="rounded-[8px] border border-border bg-muted/10 p-8 text-center">
          <FileText className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">No documents uploaded</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredDocuments.map((doc) => (
            <div key={doc.id} className="rounded-[8px] border border-border bg-card p-4 space-y-3 transition-all duration-[var(--motion-duration)] hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate text-foreground">{doc.name}</p>
                    <span className="inline-block mt-1 px-2 py-1 bg-muted/10 border border-border rounded-[8px] text-xs font-medium text-muted-foreground">
                      {doc.category}
                    </span>
                  </div>
                </div>
                <button className="text-muted-foreground hover:text-destructive transition-colors p-1 flex-shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {doc.expiration_date && (
                <div className="flex items-center gap-2">
                  <ExpirationBadge expirationDate={doc.expiration_date} />
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-2">
                <p>Uploaded: {new Date(doc.uploaded_at).toLocaleDateString()}</p>
                <p>By: {doc.uploaded_by}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
