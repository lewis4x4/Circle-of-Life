"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader, TableRowList } from "@/components/ui/table-row";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import {
  COMPLIANCE_POLICY_LIBRARY_EMPTY,
  compliancePolicyListCountLabel,
  formatCompliancePolicyPublishedDate,
} from "@/lib/compliance/policies-display-copy";
import {
  knowledgeBaseDocumentHref,
  knowledgeBasePolicyDocuments,
  type KnowledgeBaseDocumentSummary,
} from "@/lib/compliance/knowledge-base-policies";

type Row = {
  id: string;
  title: string;
  category: string;
  version: number;
  status: string;
  published_at: string | null;
};

export default function PoliciesListPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Policy text is canonical in the knowledge base (COL-707); it is organization-wide.
  const [kbDocs, setKbDocs] = useState<KnowledgeBaseDocumentSummary[] | null>(null);
  const [kbError, setKbError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, doc_type, status, word_count")
        .eq("status", "published")
        .is("deleted_at", null)
        .limit(200);
      if (cancelled) return;
      if (error) {
        setKbDocs(null);
        setKbError(error.message);
        return;
      }
      setKbError(null);
      // doc_type exists on hosted documents but is missing from the generated types.
      setKbDocs(knowledgeBasePolicyDocuments((data ?? []) as unknown as KnowledgeBaseDocumentSummary[]));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
        setRows([]);
        return;
      }
      const { data, error } = await supabase
        .from("policy_documents")
        .select("id, title, category, version, status, published_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (!error && data) setRows(data as Row[]);
      else {
        setRows([]);
        setLoadError(error?.message ?? "Policies could not be loaded.");
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const countLabel = compliancePolicyListCountLabel({
    facilityReady: ready,
    loading,
    error: loadError,
    count: rows.length,
  });

  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-6 max-w-5xl mx-auto">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border mt-4">
          <div className="space-y-2">
            <Link href="/admin/compliance" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs text-muted-foreground mb-2 uppercase tracking-wider")}>
              ← Compliance
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Policy Library
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground max-w-2xl">
              Policy text lives in the knowledge base. The policies below it are the versions staff at
              this building must acknowledge.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ready ? (
              <Link href="/admin/compliance/policies/new" className={cn(buttonVariants({ size: "default" }), "h-9 px-4 text-[10px] font-semibold bg-primary hover:bg-primary/90 text-primary-foreground")} >
                 + New Policy
              </Link>
            ) : null}
          </div>
        </header>

        <section aria-labelledby="kb-policy-text" className="p-6 rounded-lg border border-border bg-card/60">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-border pl-2">
            <h2 id="kb-policy-text" className="text-[13px] font-semibold text-foreground">
              Policy text in the knowledge base
            </h2>
            {kbDocs ? <span className="text-[12px] text-muted-foreground">{kbDocs.length} documents</span> : null}
          </div>
          <p className="text-[12px] text-muted-foreground pl-2 mb-3">
            New hires sign the manuals their job role requires during onboarding.{" "}
            <Link href="/admin/staff/onboarding-manuals" className="underline">
              Choose which manuals
            </Link>
          </p>
          {kbError ? (
            <p className="text-[13px] text-destructive pl-2" role="alert">
              Knowledge base documents could not be loaded. This is not an empty knowledge base.
            </p>
          ) : kbDocs === null ? (
            <p className="text-[13px] text-muted-foreground pl-2">Loading knowledge base documents…</p>
          ) : kbDocs.length === 0 ? (
            <p className="text-[13px] text-muted-foreground pl-2">No policy documents are published in the knowledge base yet.</p>
          ) : (
            <ul className="space-y-1">
              {kbDocs.map((d) => (
                <li key={d.id}>
                  <Link
                    href={knowledgeBaseDocumentHref(d.id)}
                    className="flex items-center justify-between rounded-md px-2 py-2 text-[13px] text-foreground hover:bg-muted"
                  >
                    <span className="truncate font-medium">{d.title}</span>
                    {d.word_count ? (
                      <span className="shrink-0 pl-4 text-[12px] tabular-nums text-muted-foreground">
                        {d.word_count.toLocaleString("en-US")} words
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="p-6 rounded-lg border border-border bg-card/60">
           <div className="flex items-center justify-between pb-4 mb-4 border-b border-border pl-2">
             <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">
               Acknowledgment versions at this building
             </h3>
             {countLabel ? <span className="text-[12px] text-muted-foreground">{countLabel}</span> : null}
           </div>

           {!ready ? (
             <FacilityGateNotice reason="Policies are versioned and acknowledged per building." />
           ) : loading ? (
             <p className="text-[13px] text-muted-foreground pl-2">Loading policies…</p>
           ) : loadError ? (
             <p className="text-[13px] text-destructive pl-2" role="alert">
               Policies could not be loaded. This is not an empty library.
             </p>
           ) : rows.length === 0 ? (
             <div className="p-12 text-center text-muted-foreground bg-muted/40 rounded-lg border border-dashed border-border">
                <p className="font-semibold text-[13px] text-foreground">{COMPLIANCE_POLICY_LIBRARY_EMPTY.title}</p>
               <p className="text-[12px] opacity-80 mt-1">{COMPLIANCE_POLICY_LIBRARY_EMPTY.description}</p>
               <Link href={COMPLIANCE_POLICY_LIBRARY_EMPTY.knowledgeBaseHref} className="mt-2 inline-block text-[12px] text-primary underline-offset-4 hover:underline">
                 {COMPLIANCE_POLICY_LIBRARY_EMPTY.knowledgeBaseLabel}
               </Link>
             </div>
           ) : (
             <TableRowList label="Policies">
               <TableRowHeader>
                 <span className="w-[112px] shrink-0">Status</span>
                 <span className="flex-[2] min-w-0">Title</span>
                 <span className="flex-1 min-w-0">Category</span>
                 <span className="w-[60px] shrink-0">Version</span>
                 <span className="w-[160px] shrink-0">Published</span>
                 <span className="w-[88px] shrink-0 text-right">Action</span>
               </TableRowHeader>
               <MotionList className="space-y-1 mt-2">
                 {rows.map((r) => {
                   const isDraft = r.status === "draft";
                   return (
                     <MotionItem key={r.id}>
                       <TableRow>
                         <div className="w-[112px] shrink-0">
                           <StatusPill tone={isDraft ? "warning" : "muted"}>
                             {r.status}
                           </StatusPill>
                         </div>
                         <span className="flex-[2] min-w-0 truncate text-[13px] font-medium text-foreground">
                           {r.title}
                         </span>
                         <span className="flex-1 min-w-0 truncate text-[12px] text-muted-foreground capitalize">
                           {r.category}
                         </span>
                         <span className="w-[60px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                           v{r.version}
                         </span>
                         <span className="w-[160px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                           {formatCompliancePolicyPublishedDate(r.published_at)}
                         </span>
                         <div className="w-[88px] shrink-0 flex justify-end">
                           <Link
                             href={`/admin/compliance/policies/${r.id}/edit`}
                             className={cn(
                               buttonVariants({ variant: "outline", size: "sm" }),
                               "h-7 px-2.5 text-[10px] font-semibold"
                             )}
                           >
                             Manage
                           </Link>
                         </div>
                       </TableRow>
                     </MotionItem>
                   );
                 })}
               </MotionList>
             </TableRowList>
           )}
        </div>
      </div>
    </div>
  );
}
