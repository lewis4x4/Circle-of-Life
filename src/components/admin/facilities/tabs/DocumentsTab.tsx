"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  LayoutGrid,
  List,
  Loader2,
  Trash2,
  Upload,
  Download,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileInput } from "@/components/ui/file-input";
import { FacilityFormSelect } from "@/components/ui/facility-form-select";
import { Input } from "@/components/ui/input";
import type { DocumentVaultCategoryKey } from "@/lib/admin/facilities/document-vault-taxonomy";
import {
  DOCUMENT_CATEGORY_EXPIRATION_NA,
  DOCUMENT_VAULT_CATEGORY_KEYS,
  DOCUMENT_VAULT_CATEGORY_LABELS,
  DOCUMENT_VAULT_CATEGORY_PARENT,
  DOCUMENT_VAULT_PARENT_LABELS,
  DOCUMENT_VAULT_PARENTS,
  vaultCategoryExpirationRequired,
} from "@/lib/admin/facilities/document-vault-taxonomy";
import { useFacilityDocuments, type FacilityDocumentHookRow } from "@/hooks/useFacilityDocuments";
import { formatDocumentsTabUploaderDisplay } from "@/lib/facilities/documents-tab-display-copy";
import { cn } from "@/lib/utils";

interface DocumentsTabProps {
  facilityId: string;
}

const LS_VIEW = "haven:facility-doc-vault:view";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromToday(isoDate: string): number {
  const t0 = new Date(isoToday()).getTime();
  const t1 = new Date(`${isoDate}T12:00:00.000Z`).getTime();
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

function categoryLabel(key: string): string {
  const k = key as DocumentVaultCategoryKey;
  return DOCUMENT_VAULT_CATEGORY_LABELS[k] ?? key;
}

function displayTitle(doc: FacilityDocumentHookRow): string {
  const t = doc.friendly_title?.trim();
  return t && t.length > 0 ? t : doc.document_name;
}

function expirationVisual(doc: FacilityDocumentHookRow): {
  line: string;
  className: string;
} {
  const key = doc.document_category as DocumentVaultCategoryKey;
  if (DOCUMENT_CATEGORY_EXPIRATION_NA.has(key)) {
    return { line: "N/A", className: "text-muted-foreground" };
  }
  if (!doc.expiration_date) {
    return { line: "No expiry on file", className: "text-muted-foreground" };
  }
  const days = daysFromToday(doc.expiration_date);
  const formatted = new Date(`${doc.expiration_date}T12:00:00`).toLocaleDateString();
  if (days < 0) {
    return { line: `Expired ${Math.abs(days)} days ago`, className: "text-destructive font-medium" };
  }
  if (days < 60) {
    return { line: `Expires ${formatted} · in ${days} days`, className: "text-warning font-medium" };
  }
  return { line: `Expires ${formatted} · in ${days} days`, className: "text-muted-foreground" };
}

export function DocumentsTab({ facilityId }: DocumentsTabProps) {
  const {
    documents,
    isLoading,
    error,
    uploadFile,
    isUploading,
    archiveDocument,
    fetchSignedUrl,
    archivedScope,
    setArchivedScope,
  } = useFacilityDocuments(facilityId);

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"expiring" | "recent" | "alpha" | "category">("expiring");
  const [parentChip, setParentChip] = useState<string>("__all");
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    try {
      const v = window.localStorage.getItem(LS_VIEW);
      return v === "list" || v === "grid" ? v : "grid";
    } catch {
      return "grid";
    }
  });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FacilityDocumentHookRow | null>(null);

  type PendingRow = {
    cid: string;
    file: File;
    category: DocumentVaultCategoryKey | "";
    expiration: string;
    carrier: string;
    friendlyTitle: string;
    notes: string;
  };

  const [pending, setPending] = useState<PendingRow[]>([]);

  const persistView = (next: "grid" | "list") => {
    setView(next);
    try {
      window.localStorage.setItem(LS_VIEW, next);
    } catch {
      /* ignore */
    }
  };

  const categoryOpts = useMemo(
    () => DOCUMENT_VAULT_CATEGORY_KEYS.map((k) => ({ value: k, label: DOCUMENT_VAULT_CATEGORY_LABELS[k] })),
    [],
  );

  const parentCounts = useMemo(() => {
    const counts: Record<string, number> = { __all: documents.length };
    for (const p of DOCUMENT_VAULT_PARENTS) counts[p] = 0;
    for (const d of documents) {
      const pk =
        DOCUMENT_VAULT_CATEGORY_PARENT[d.document_category as DocumentVaultCategoryKey] ?? "reference";
      counts[pk] = (counts[pk] ?? 0) + 1;
    }
    return counts;
  }, [documents]);

  const attentionDocs = useMemo(() => {
    return documents.filter((d) => {
      const key = d.document_category as DocumentVaultCategoryKey;
      if (DOCUMENT_CATEGORY_EXPIRATION_NA.has(key)) return false;
      if (!d.expiration_date) return false;
      const days = daysFromToday(d.expiration_date);
      return days <= 60;
    });
  }, [documents]);

  const filteredSorted = useMemo(() => {
    let rows = [...documents];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) => {
        const hay = [
          displayTitle(d),
          d.document_name,
          categoryLabel(d.document_category),
          (d.carrier ?? "").toLowerCase(),
          (d.notes ?? "").toLowerCase(),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (parentChip !== "__all") {
      rows = rows.filter(
        (d) =>
          (DOCUMENT_VAULT_CATEGORY_PARENT[d.document_category as DocumentVaultCategoryKey] ??
            "reference") === parentChip,
      );
    }

    rows.sort((a, b) => {
      switch (sortMode) {
        case "recent":
          return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
        case "alpha":
          return displayTitle(a).localeCompare(displayTitle(b));
        case "category":
          return categoryLabel(a.document_category).localeCompare(categoryLabel(b.document_category));
        case "expiring":
        default: {
          const ae = a.expiration_date;
          const be = b.expiration_date;
          if (!ae && !be) return 0;
          if (!ae) return 1;
          if (!be) return -1;
          return ae.localeCompare(be);
        }
      }
    });

    return rows;
  }, [documents, search, sortMode, parentChip]);

  const addFiles = useCallback((files: File[]) => {
    const rows: PendingRow[] = files.map((file) => ({
      cid: crypto.randomUUID(),
      file,
      category: "",
      expiration: "",
      carrier: "",
      friendlyTitle: "",
      notes: "",
    }));
    setPending((prev) => [...prev, ...rows]);
  }, []);

  const submitUploadBatch = async (supersedesId?: string, vaultSeriesId?: string | null) => {
    const rows = [...pending];
    for (const row of rows) {
      if (!row.category) continue;
      const needExp = vaultCategoryExpirationRequired(row.category as DocumentVaultCategoryKey);
      if (needExp && !row.expiration) continue;
      await uploadFile(row.file, {
        category: row.category,
        fileName: row.file.name,
        expirationDate: row.expiration || undefined,
        carrier: row.carrier || undefined,
        friendlyTitle: row.friendlyTitle || undefined,
        notes: row.notes || undefined,
        supersedesDocumentId: supersedesId,
        vaultSeriesId: vaultSeriesId ?? undefined,
      });
      if (supersedesId) break;
    }
    setPending([]);
    setUploadOpen(false);
    setReplaceTargetId(null);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!previewId) {
        setPreviewUrl(null);
        return;
      }
      const u = await fetchSignedUrl(previewId);
      if (!cancelled) setPreviewUrl(u);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [previewId, fetchSignedUrl]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
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

  const previewDoc = previewId ? documents.find((d) => d.id === previewId) : undefined;

  return (
    <div className="space-y-5">
      {attentionDocs.length > 0 && !archivedScope ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Attention required</p>
          <ul className="mt-3 space-y-2">
            {attentionDocs.slice(0, 10).map((d) => {
              const v = expirationVisual(d);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                  <span className="truncate font-medium">{displayTitle(d)}</span>
                  <span className={cn("text-xs", v.className)}>{v.line}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-primary"
                    onClick={() => {
                      setReplaceTargetId(d.id);
                      setPending([
                        {
                          cid: crypto.randomUUID(),
                          file: new File([], ""),
                          category: (d.document_category ?? "") as DocumentVaultCategoryKey,
                          expiration: "",
                          carrier: d.carrier ?? "",
                          friendlyTitle: d.friendly_title ?? "",
                          notes: "",
                        },
                      ]);
                      setUploadOpen(true);
                    }}
                  >
                    Replace →
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename, category, carrier, notes…"
            className="max-w-sm"
          />

          <FacilityFormSelect<"expiring" | "recent" | "alpha" | "category">
            label="Sort"
            hideLabel
            placeholder="Sort"
            value={sortMode}
            options={[
              { value: "expiring", label: "Expiring soonest" },
              { value: "recent", label: "Most recent" },
              { value: "alpha", label: "Alphabetical" },
              { value: "category", label: "By category" },
            ]}
            onValueChange={(v) => setSortMode(v)}
            className="w-44 [&_button]:justify-between"
          />

          <div className="flex gap-1 rounded-md border border-border p-1">
            <Button
              type="button"
              variant={view === "grid" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => persistView("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              type="button"
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => persistView("list")}
              aria-label="List view"
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => {
            setReplaceTargetId(null);
            setPending([]);
            setUploadOpen(true);
          }}
        >
          <Upload className="size-4" aria-hidden /> Upload
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => {
            setArchivedScope(false);
            setParentChip("__all");
          }}
          className={cn(
            "whitespace-nowrap rounded-[8px] border px-3 py-1 text-sm font-medium",
            !archivedScope
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/20",
          )}
        >
          All ({documents.length})
        </button>
        {DOCUMENT_VAULT_PARENTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setParentChip((cur) => (cur === p ? "__all" : p))}
            className={cn(
              "whitespace-nowrap rounded-[8px] border px-3 py-1 text-sm font-medium",
              parentChip === p
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/20",
            )}
          >
            {DOCUMENT_VAULT_PARENT_LABELS[p]} ({parentCounts[p] ?? 0})
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setArchivedScope(true);
            setParentChip("__all");
          }}
          className={cn(
            "whitespace-nowrap rounded-[8px] border px-3 py-1 text-sm font-medium",
            archivedScope
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/20",
          )}
        >
          Archived (30 days)
        </button>
      </div>

      <div
        className="min-h-[200px] rounded-lg border border-dashed border-muted-foreground/20 p-2 transition-colors hover:border-primary/40"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const fl = Array.from(e.dataTransfer.files ?? []);
          if (!fl.length) return;
          addFiles(fl);
          setReplaceTargetId(null);
          setUploadOpen(true);
        }}
      >
        {filteredSorted.length === 0 ? (
          <div className="flex flex-col gap-4 py-12 text-center text-sm text-muted-foreground">
            <p>No documents match filters.</p>
            <p>Drop PDFs/images here or use Upload.</p>
          </div>
        ) : view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSorted.map((doc) => {
              const v = expirationVisual(doc);
              return (
                <div
                  role="button"
                  tabIndex={0}
                  key={doc.id}
                  onClick={() => setPreviewId(doc.id)}
                  onKeyDown={(ev) =>
                    ev.key === "Enter" || ev.key === " " ? (ev.preventDefault(), setPreviewId(doc.id)) : null
                  }
                  className={cn(
                    "rounded-[8px] border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className="line-clamp-2 text-sm font-medium text-foreground"
                      title={`${displayTitle(doc)} (${doc.document_name})`}
                    >
                      {displayTitle(doc)}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Archive ${doc.document_name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(doc);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>

                  <p className="mt-1 text-[11px] text-muted-foreground">{categoryLabel(doc.document_category)}</p>

                  {doc.carrier?.trim() ? (
                    <p className="mt-1 text-[12px] text-muted-foreground">Carrier: {doc.carrier}</p>
                  ) : null}

                  {doc.file_size_bytes != null ? (
                    <p className="text-[11px] text-muted-foreground">
                      {(doc.file_size_bytes / 1024).toFixed(1)} KB · {doc.mime_type ?? ""}
                    </p>
                  ) : null}

                  <p className={cn("mt-2 text-xs", v.className)}>{v.line}</p>

                  <p className="mt-2 border-t border-border pt-2 text-[12px] text-muted-foreground">
                    Uploaded {new Date(doc.uploaded_at).toLocaleDateString()} by{" "}
                    {formatDocumentsTabUploaderDisplay(doc.uploaded_by_display)}
                  </p>

                </div>
              );
            })}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Title</th>
                <th className="py-2 pr-2 font-medium">Category</th>
                <th className="py-2 pr-2 font-medium">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((doc) => {
                const v = expirationVisual(doc);
                return (
                  <tr
                    key={doc.id}
                    className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                    onClick={() => setPreviewId(doc.id)}
                  >
                    <td className="py-2 pr-2 font-medium">{displayTitle(doc)}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{categoryLabel(doc.document_category)}</td>
                    <td className={cn("py-2 pr-2 text-xs", v.className)}>{v.line}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog
        open={uploadOpen}
        onOpenChange={(o) => {
          if (!o) {
            setUploadOpen(false);
            setPending([]);
            setReplaceTargetId(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{replaceTargetId ? "Replace document" : "Upload documents"}</DialogTitle>
          </DialogHeader>

          {!replaceTargetId ? <FileInput multiple onChange={addFiles} /> : null}

          <div className="space-y-4">
            {pending.map((row) => {
              const needExp =
                !!row.category && vaultCategoryExpirationRequired(row.category as DocumentVaultCategoryKey);
              const readyBase = !!row.category && row.file.size > 0 && (!needExp || !!row.expiration);

              return (
                <div key={row.cid} className="space-y-3 rounded-lg border border-border p-3">
                  {replaceTargetId ? (
                    <FileInput
                      multiple={false}
                      browseLabel="Choose replacement…"
                      onChange={(files) => {
                        const f = files[0];
                        if (!f) return;
                        setPending((prev) => prev.map((r) => (r.cid === row.cid ? { ...r, file: f } : r)));
                      }}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">{row.file.name}</p>
                  )}

                  <FacilityFormSelect<DocumentVaultCategoryKey>
                    label="Category"
                    placeholder="Choose a category"
                    value={(row.category as DocumentVaultCategoryKey) || ""}
                    options={categoryOpts}
                    onValueChange={(v) =>
                      setPending((prev) => prev.map((r) => (r.cid === row.cid ? { ...r, category: v } : r)))
                    }
                  />

                  {needExp ? (
                    <DateInput
                      value={row.expiration}
                      onValueChange={(v) =>
                        setPending((prev) => prev.map((r) => (r.cid === row.cid ? { ...r, expiration: v } : r)))
                      }
                      aria-label={`Expiration ${row.file.name}`}
                      emptyHint="Required — renewal date MM/DD/YYYY"
                    />
                  ) : row.category ? (
                    <DateInput
                      value={row.expiration}
                      onValueChange={(v) =>
                        setPending((prev) => prev.map((r) => (r.cid === row.cid ? { ...r, expiration: v } : r)))
                      }
                      aria-label={`Expiration optional ${row.file.name}`}
                      emptyHint="Optional — MM/DD/YYYY"
                    />
                  ) : null}

                  <Input
                    value={row.carrier}
                    onChange={(e) =>
                      setPending((prev) => prev.map((r) => (r.cid === row.cid ? { ...r, carrier: e.target.value } : r)))
                    }
                    placeholder="Carrier (optional)"
                  />

                  <Input
                    value={row.friendlyTitle}
                    onChange={(e) =>
                      setPending((prev) =>
                        prev.map((r) => (r.cid === row.cid ? { ...r, friendlyTitle: e.target.value } : r)),
                      )
                    }
                    placeholder="Friendly title (optional)"
                  />

                  {!replaceTargetId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setPending((prev) => prev.filter((x) => x.cid !== row.cid))}
                    >
                      Remove row
                    </Button>
                  ) : null}

                  {!readyBase ? (
                    <p className="text-[11px] text-muted-foreground">
                      {!row.file.size ? "Select a replacement file." : null}
                      {row.category && needExp && !row.expiration ? " Expiration date required." : null}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>

            <Button
              type="button"
              disabled={
                pending.length === 0 ||
                isUploading ||
                pending.some((r) => !r.category) ||
                pending.some((r) => vaultCategoryExpirationRequired(r.category as DocumentVaultCategoryKey) && !r.expiration) ||
                pending.some((r) => !r.file.size)
              }
              onClick={() => {
                void (async () => {
                  if (replaceTargetId) {
                    const t = documents.find((d) => d.id === replaceTargetId);
                    if (!t) return;
                    await submitUploadBatch(t.id, t.vault_series_id ?? t.id);
                    return;
                  }
                  await submitUploadBatch(undefined, undefined);
                })();
              }}
            >
              {isUploading ? "Uploading…" : replaceTargetId ? "Replace" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewId} onOpenChange={(o) => !o && setPreviewId(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{previewDoc ? displayTitle(previewDoc) : "Preview"}</DialogTitle>
          </DialogHeader>
          {previewUrl ? (
            <div className="h-[72vh] w-full rounded-md border border-border bg-muted/20">
              <iframe title="Document preview" src={previewUrl} className="h-full w-full rounded-md bg-background" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading preview…</p>
          )}
          <DialogFooter className="flex flex-wrap gap-2">
            {previewUrl ? (
              <a
                href={previewUrl}
                download
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
              >
                <Download className="size-4" aria-hidden /> Download
              </a>
            ) : null}
            {previewId && previewDoc ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const d = previewDoc;
                  setReplaceTargetId(d.id);
                  setPending([
                    {
                      cid: crypto.randomUUID(),
                      file: new File([], ""),
                      category: d.document_category as DocumentVaultCategoryKey,
                      expiration: "",
                      carrier: d.carrier ?? "",
                      friendlyTitle: d.friendly_title ?? "",
                      notes: "",
                    },
                  ]);
                  setPreviewId(null);
                  setUploadOpen(true);
                }}
              >
                Replace
              </Button>
            ) : null}
            <Button type="button" onClick={() => setPreviewId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive document?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Archive <span className="font-medium text-foreground">{deleteTarget?.document_name ?? ""}</span>? This removes
            it from active view for 30 days. Use Replace for compliance renewals when possible.
          </p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                void archiveDocument(deleteTarget.id).then(() => setDeleteTarget(null));
              }}
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
