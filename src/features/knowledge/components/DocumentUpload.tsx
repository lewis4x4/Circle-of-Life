"use client";

import React, { useState, useCallback } from "react";
import { Upload, X, Loader2, Check, AlertTriangle } from "lucide-react";
import { uploadDocument } from "../lib/knowledge-api";
import type { DocumentAudience } from "../lib/types";

interface DocumentUploadProps {
  workspaceId: string | null;
  workspaceLoading: boolean;
  onSuccess?: () => void;
}

const AUDIENCE_OPTIONS: { value: DocumentAudience; label: string }[] = [
  { value: "company_wide", label: "All Staff" },
  { value: "department_specific", label: "Department Specific" },
  { value: "leadership", label: "Leadership Only" },
  { value: "admin_owner", label: "Admin & Owner" },
  { value: "owner_only", label: "Owner Only" },
];

export function DocumentUpload({ workspaceId, workspaceLoading, onSuccess }: DocumentUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<DocumentAudience>("company_wide");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) {
        setFile(dropped);
        if (!title) setTitle(dropped.name.replace(/\.[^.]+$/, ""));
      }
    },
    [title],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      if (!title) setTitle(selected.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleUpload = async () => {
    if (!file || !title.trim() || !workspaceId) return;
    setUploading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = (await uploadDocument(file, title.trim(), audience, workspaceId)) as { error?: string };
      if (result.error) throw new Error(result.error);
      setSuccess(true);
      setFile(null);
      setTitle("");
      setAudience("company_wide");
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const disabled = !workspaceId || workspaceLoading;

  return (
    <div className="space-y-4">
      {disabled && (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {workspaceLoading ? "Loading organization context…" : "Organization context is required to upload."}
        </p>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          dragActive
            ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20"
            : "border-slate-200 dark:border-zinc-700 hover:border-slate-300 dark:hover:border-zinc-600"
        }`}
      >
        {file ? (
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm text-slate-700 dark:text-zinc-300">{file.name}</span>
            <button type="button" onClick={() => setFile(null)} className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-zinc-700">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        ) : (
          <label className="cursor-pointer">
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500 dark:text-zinc-400">Drop a file here or click to browse</p>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">PDF, Word, Excel, Markdown, Text</p>
            <input type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.docx,.xlsx,.xls,.csv,.md,.txt" />
          </label>
        )}
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Document title"
        disabled={disabled}
        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
      />

      <select
        value={audience}
        onChange={(e) => setAudience(e.target.value as DocumentAudience)}
        disabled={disabled}
        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
      >
        {AUDIENCE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <Check className="w-4 h-4 shrink-0" />
          Document uploaded and indexed successfully
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleUpload()}
        disabled={!file || !title.trim() || uploading || disabled}
        className="w-full rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading ? "Uploading & Indexing…" : "Upload Document"}
      </button>
    </div>
  );
}
