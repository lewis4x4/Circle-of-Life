"use client";

import { useState } from "react";
import Link from "next/link";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { cn } from "@/lib/utils";

type Suggestion = {
  slug: string;
  reason: string;
};

function suggestTemplate(query: string): Suggestion | null {
  const q = query.toLowerCase();
  const direct = PHASE1_TEMPLATE_SEED.find(
    (template) =>
      template.name.toLowerCase().includes(q) ||
      template.tags.some((tag) => q.includes(tag.toLowerCase())),
  );
  if (direct) return { slug: direct.slug, reason: "Matched by template name/tag." };
  if (q.includes("fall") || q.includes("incident")) {
    return { slug: "incident-trend-summary", reason: "Detected incident/fall intent." };
  }
  if (q.includes("staff") || q.includes("coverage")) {
    return { slug: "staffing-coverage-by-shift", reason: "Detected staffing coverage intent." };
  }
  if (q.includes("ar") || q.includes("aging") || q.includes("collections")) {
    return { slug: "ar-aging-summary", reason: "Detected receivables/AR intent." };
  }
  if (q.includes("survey") || q.includes("compliance")) {
    return { slug: "survey-readiness-summary", reason: "Detected survey/compliance intent." };
  }
  return null;
}

export default function ReportsNlqPage() {
  const [query, setQuery] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  function onSuggest() {
    setSuggestion(suggestTemplate(query));
  }

  const template = suggestion
    ? PHASE1_TEMPLATE_SEED.find((item) => item.slug === suggestion.slug) ?? null
    : null;

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">NLQ-assisted reporting</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Natural language maps to approved templates and governed report definitions.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ask a reporting question</CardTitle>
          <CardDescription>
            AI assistance suggests templates only; RBAC and official metrics remain enforced.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="Example: Show me falls by facility over the last 90 days."
          />
          <Button onClick={onSuggest}>Suggest template</Button>
          {template && suggestion && (
            <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
              <p className="font-medium text-slate-900 dark:text-slate-100">{template.name}</p>
              <p className="text-slate-600 dark:text-slate-300">{suggestion.reason}</p>
              <div className="mt-2 flex gap-2">
                <Link href={`/admin/reports/run/template/${template.slug}`} className={cn(buttonVariants({ size: "sm" }))}>
                  Run suggestion
                </Link>
                <Link
                  href={`/admin/reports/templates/${template.slug}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  View definition
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
