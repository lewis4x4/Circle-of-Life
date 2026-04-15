"use client";

import React, { useState } from "react";
import { FileText, BarChart3, HelpCircle, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentUpload } from "../components/DocumentUpload";
import { DoctrineReviewQueue } from "../components/DoctrineReviewQueue";
import { DocumentTable } from "../components/DocumentTable";
import { KBHealthPanel } from "../components/KBHealthPanel";
import { ChatInsightsPanel } from "../components/ChatInsightsPanel";
import { KnowledgeGapsPanel } from "../components/KnowledgeGapsPanel";
import { useDocuments } from "../hooks/useDocuments";
import { useKnowledgeGaps } from "../hooks/useKnowledgeGaps";
import { useKBHealth } from "../hooks/useKBHealth";
import { useKbWorkspaceId } from "../hooks/useKbWorkspaceId";

const TABS = [
  { key: "documents", label: "Documents", icon: FileText },
  { key: "gaps", label: "Knowledge Gaps", icon: HelpCircle },
  { key: "health", label: "Health", icon: Activity },
  { key: "insights", label: "Insights", icon: BarChart3 },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function KnowledgeAdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("documents");
  const { workspaceId, loading: workspaceLoading, error: workspaceError, reload: reloadWorkspace } = useKbWorkspaceId();
  const { documents, loading: docsLoading, error: docsError, reload: reloadDocs } = useDocuments();
  const { gaps, loading: gapsLoading, error: gapsError, resolve: resolveGap, resolveError, reload: reloadGaps } = useKnowledgeGaps();
  const { health, insights, loading: healthLoading, error: healthError, reload: reloadHealth } = useKBHealth();

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-slate-100 dark:bg-zinc-800/50 rounded-xl p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 shadow-sm"
                  : "text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "documents" && (
        <div className="space-y-6">
          {workspaceError && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-4 text-sm text-amber-900 dark:text-amber-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">Knowledge upload is not ready.</div>
                <div className="text-amber-800/90 dark:text-amber-100/90">{workspaceError}</div>
              </div>
              <Button type="button" variant="outline" onClick={() => void reloadWorkspace()} className="border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-950/60">
                Retry workspace
              </Button>
            </div>
          )}
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200 mb-4">Upload Document</h3>
            <DocumentUpload workspaceId={workspaceId} workspaceLoading={workspaceLoading} onSuccess={reloadDocs} />
          </div>
          <div className="rounded-xl border border-indigo-200/60 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100">
            Uploaded documents may finish indexing in the background. In this table, <span className="font-semibold">Pending Review</span> means indexing finished and the document is ready for human review, while <span className="font-semibold">Ingest Failed</span> means the document needs a <span className="font-semibold">Re-index</span> retry after the source issue is fixed.
          </div>
          {docsLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">Loading documents…</div>
          ) : docsError ? (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-4 text-sm text-red-800 dark:text-red-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">Could not load documents.</div>
                <div className="text-red-700/90 dark:text-red-200/90">{docsError}</div>
              </div>
              <Button type="button" variant="outline" onClick={() => void reloadDocs()} className="border-red-300 text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/60">
                Retry documents
              </Button>
            </div>
          ) : (
            <>
              <DoctrineReviewQueue documents={documents} onRefresh={reloadDocs} />
              <DocumentTable documents={documents} onRefresh={reloadDocs} />
            </>
          )}
        </div>
      )}

      {activeTab === "gaps" && (
        <div className="space-y-3">
          {resolveError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200">
              {resolveError}
            </div>
          )}
          {gapsError ? (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-4 text-sm text-red-800 dark:text-red-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">Could not load knowledge gaps.</div>
                <div className="text-red-700/90 dark:text-red-200/90">{gapsError}</div>
              </div>
              <Button type="button" variant="outline" onClick={() => void reloadGaps()} className="border-red-300 text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/60">
                Retry gaps
              </Button>
            </div>
          ) : (
            <KnowledgeGapsPanel gaps={gaps} loading={gapsLoading} onResolve={resolveGap} />
          )}
        </div>
      )}

      {activeTab === "health" && (
        healthError ? (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-4 text-sm text-red-800 dark:text-red-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">Could not load knowledge health.</div>
              <div className="text-red-700/90 dark:text-red-200/90">{healthError}</div>
            </div>
            <Button type="button" variant="outline" onClick={() => void reloadHealth()} className="border-red-300 text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/60">
              Retry health
            </Button>
          </div>
        ) : (
          <KBHealthPanel health={health} loading={healthLoading} />
        )
      )}

      {activeTab === "insights" && (
        healthError ? (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-4 text-sm text-red-800 dark:text-red-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">Could not load chat insights.</div>
              <div className="text-red-700/90 dark:text-red-200/90">{healthError}</div>
            </div>
            <Button type="button" variant="outline" onClick={() => void reloadHealth()} className="border-red-300 text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/60">
              Retry insights
            </Button>
          </div>
        ) : (
          <ChatInsightsPanel insights={insights} loading={healthLoading} />
        )
      )}
    </div>
  );
}
