"use client";

import { useMemo, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { TemplateCard } from "@/components/reports/template-card";
import { Input } from "@/components/ui/input";
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
    <div className="space-y-6">
      <ReportsHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Template library</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Browse official templates by role, category, and recurring workflow.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <Input
          placeholder="Search templates (e.g. falls, AR, survey)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All categories" : option}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.slug}
            slug={template.slug}
            name={template.name}
            category={template.category}
            description={template.description}
            audience={template.audience}
            defaultRange={template.defaultRange}
            tags={template.tags}
          />
        ))}
      </div>
    </div>
  );
}
