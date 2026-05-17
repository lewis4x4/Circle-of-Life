"use client";

import React from "react";
import Link from "next/link";
import { KnowledgeAdminPage } from "@/features/knowledge/pages/KnowledgeAdminPage";

export default function KnowledgeAdminRoute() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">
            Knowledge Base Admin
          </h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Manage documents, review gaps, and monitor health
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/knowledge/coverage"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"
          >
            Coverage dashboard →
          </Link>
          <Link
            href="/admin/knowledge/seed-targets"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"
          >
            Seed targets →
          </Link>
        </div>
      </div>
      <KnowledgeAdminPage />
    </div>
  );
}
