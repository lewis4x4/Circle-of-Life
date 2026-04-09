"use client";

import { useMemo, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { TemplateCard } from "@/components/reports/template-card";
import { Input } from "@/components/ui/input";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";

export default function ReportTemplatesPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(PHASE1_TEMPLATE_SEED.map((template) => template.category)))],
    [],
  );

  const templates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PHASE1_TEMPLATE_SEED.filter((template) => {
      if (category !== "all" && template.category !== category) return false;
      if (!q) return true;
      return (
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [category, query]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/5"
        secondaryClass="bg-slate-900/5"
      />
      
      <div className="relative z-10 space-y-6 max-w-7xl mx-auto">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Template Library
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Browse official templates by role, category, and recurring workflow.
            </p>
          </div>
        </header>

        <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
          <div className="flex flex-col md:flex-row gap-4 mb-8">
            <div className="flex-1">
              <Input
                placeholder="Search templates (e.g. falls, AR, survey)"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-black/30 px-5 py-2 text-sm backdrop-blur-xl shadow-inner focus-visible:ring-indigo-500 font-mono tracking-wide"
              />
            </div>
            <div className="md:w-72 shrink-0 relative">
              <select
                className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white/60 px-5 py-2 text-sm dark:border-white/10 dark:bg-black/30 backdrop-blur-xl shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-mono uppercase tracking-widest text-[11px] font-bold text-slate-700 dark:text-slate-200"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {categories.map((option) => (
                  <option key={option} value={option} className="dark:bg-slate-900 py-1 font-sans capitalize tracking-normal text-sm font-medium">
                    {option === "all" ? "All Categories" : option}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400 font-bold">
                 ↓
              </div>
            </div>
          </div>

          {templates.length === 0 ? (
             <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Templates Found</p>
               <p className="text-sm opacity-80 mt-1 font-mono">Try adjusting your search query or clear filters.</p>
             </div>
          ) : (
            <KineticGrid className="grid-cols-1 lg:grid-cols-2 gap-6" staggerMs={60}>
              {templates.map((template) => (
                <div key={template.slug} className="h-full">
                  <TemplateCard
                    slug={template.slug}
                    name={template.name}
                    category={template.category}
                    description={template.description}
                    audience={template.audience}
                    defaultRange={template.defaultRange}
                    tags={template.tags}
                  />
                </div>
              ))}
            </KineticGrid>
          )}
        </div>
      </div>
    </div>
  );
}
