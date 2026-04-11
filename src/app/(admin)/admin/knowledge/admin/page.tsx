"use client";

import React from "react";
import { KnowledgeAdminPage } from "@/features/knowledge/pages/KnowledgeAdminPage";

export default function KnowledgeAdminRoute() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Knowledge Base Admin</h1>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          Manage documents, review gaps, and monitor health
        </p>
      </div>
      <KnowledgeAdminPage />
    </div>
  );
}
