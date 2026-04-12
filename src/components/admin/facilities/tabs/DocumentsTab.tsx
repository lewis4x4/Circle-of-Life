"use client";

import React, { useState, useRef } from "react";
import { Loader2, Upload, FileText, Trash2 } from "lucide-react";
import { useFacilityDocuments } from "@/hooks/useFacilityDocuments";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/lib/admin/facilities/facility-constants";
import { ExpirationBadge } from "../shared/ExpirationBadge";

interface DocumentsTabProps {
  facilityId: string;
}

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
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-6 sm:p-8 space-y-4 shadow-sm backdrop-blur-2xl">
        <h3 className="font-semibold flex items-center gap-2">
          <Upload className="h-5 w-5 text-teal-500" />
          Upload Document
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* File input */}
          <div>
            <label className="block text-sm font-medium mb-2">Select File</label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="block w-full text-sm text-gray-500 file:mr-4 file:px-3 file:py-2 file:border file:border-gray-300 file:rounded-lg file:text-sm file:font-medium file:bg-slate-50/50 dark:bg-white/5 hover:file:bg-gray-100"
            />
            {selectedFile && <p className="mt-2 text-sm text-teal-400">{selectedFile.name}</p>}
          </div>

          {/* Category select */}
          <div>
            <label className="block text-sm font-medium mb-2">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Select category...</option>
              {DOCUMENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {DOCUMENT_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          {/* Expiration date */}
          <div>
            <label className="block text-sm font-medium mb-2">Expiration Date (optional)</label>
            <input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* Upload button */}
          <div className="flex items-end">
            <button
              onClick={handleUpload}
              disabled={!selectedFile || !selectedCategory || isUploading}
              className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors font-medium"
            >
              {isUploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>
      </div>

      {/* Category Filter */}
      {documents.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setCategoryFilter("")}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              categoryFilter === ""
                ? "bg-teal-500/100/20 text-teal-700"
                : "bg-gray-100 text-slate-700 dark:text-slate-300 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          {Array.from(new Set(documents.map((d) => d.category))).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                categoryFilter === cat ? "bg-teal-500/100/20 text-teal-700" : "bg-gray-100 text-slate-700 dark:text-slate-300 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Documents Grid */}
      {filteredDocuments.length === 0 ? (
        <div className="rounded-lg border border-slate-200/50 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 p-8 text-center">
          <FileText className="h-8 w-8 mx-auto mb-3 text-slate-500 dark:text-slate-400" />
          <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">No documents uploaded</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredDocuments.map((doc) => (
            <div key={doc.id} className="rounded-lg border border-slate-200/50 dark:border-white/10 bg-white p-4 space-y-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <FileText className="h-5 w-5 text-teal-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <span className="inline-block mt-1 px-2 py-1 bg-gray-100 text-slate-700 dark:text-slate-300 rounded text-xs font-medium">
                      {doc.category}
                    </span>
                  </div>
                </div>
                <button className="text-slate-500 dark:text-slate-400 hover:text-red-600 transition-colors p-1 flex-shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {doc.expiration_date && (
                <div className="flex items-center gap-2">
                  <ExpirationBadge expirationDate={doc.expiration_date} />
                </div>
              )}

              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 border-t border-slate-200/40 dark:border-white/5 pt-2">
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
