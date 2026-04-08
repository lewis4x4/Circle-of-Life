"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { FileUp, Info } from "lucide-react";

import { ExportMarkdownButton } from "@/components/onboarding/export-markdown-button";
import { OnboardingQuestionField } from "@/components/onboarding/onboarding-question-field";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnboardingStore } from "@/hooks/useOnboardingStore";
import type { ConfidenceLevel } from "@/lib/onboarding/types";
import { cn } from "@/lib/utils";

export default function OnboardingQuestionsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const questionsById = useOnboardingStore((s) => s.questionsById);
  const responsesByQuestionId = useOnboardingStore((s) => s.responsesByQuestionId);
  const organizationLabel = useOnboardingStore((s) => s.organizationLabel);
  const defaultEnteredByName = useOnboardingStore((s) => s.defaultEnteredByName);
  const setOrganizationLabel = useOnboardingStore((s) => s.setOrganizationLabel);
  const setDefaultEnteredByName = useOnboardingStore((s) => s.setDefaultEnteredByName);
  const setResponseValue = useOnboardingStore((s) => s.setResponseValue);
  const setResponseConfidence = useOnboardingStore((s) => s.setResponseConfidence);
  const setEnteredByForQuestion = useOnboardingStore((s) => s.setEnteredByForQuestion);
  const importQuestionFileJson = useOnboardingStore((s) => s.importQuestionFileJson);

  const sortedQuestions = useMemo(
    () =>
      Object.values(questionsById).sort((a, b) => {
        const d = a.department.localeCompare(b.department);
        if (d !== 0) return d;
        return a.id.localeCompare(b.id);
      }),
    [questionsById],
  );

  const stats = useMemo(() => {
    const required = sortedQuestions.filter((q) => q.required !== false);
    const answeredRequired = required.filter((q) => {
      const v = responsesByQuestionId[q.id]?.value?.trim() ?? "";
      return v.length > 0;
    }).length;
    return {
      total: sortedQuestions.length,
      requiredTotal: required.length,
      answeredRequired,
      pct: required.length === 0 ? 100 : Math.round((answeredRequired / required.length) * 100),
    };
  }, [sortedQuestions, responsesByQuestionId]);

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setImportMessage(null);
      setImportError(null);
      const text = await file.text();
      const result = importQuestionFileJson(text);
      if (result.ok) {
        setImportMessage(`Imported successfully: ${result.added} new, ${result.updated} updated (by id).`);
      } else {
        setImportError(result.error);
      }
    },
    [importQuestionFileJson],
  );

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold text-white">Questions &amp; answers</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Answers stay in this browser (local storage) until you export—treat exports as sensitive if they may contain
            PHI. Import JSON packs to add or update questions: matching <code className="text-slate-300">id</code>{" "}
            updates wording and keeps existing answers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportMarkdownButton />
          <Link
            href="/onboarding/questions-import.template.json"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "border-white/20 bg-transparent text-slate-100 hover:bg-white/10",
            )}
          >
            Download JSON template
          </Link>
        </div>
      </div>

      <div
        className="flex gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-50"
        role="note"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
        <div>
          <p className="font-medium text-teal-100">LLM export</p>
          <p className="mt-1 text-teal-100/90">
            Use <strong>Export answers (Markdown)</strong> anytime for a single file with stable question ids, fenced
            answers, confidence, and attribution—optimized for downstream prompts and tools.
          </p>
        </div>
      </div>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardHeader>
          <CardTitle className="text-white">Workspace</CardTitle>
          <CardDescription className="text-slate-400">
            Defaults apply to new edits; override per question when a shared login is used.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-slate-300">
            Organization label (in export)
            <Input
              value={organizationLabel}
              onChange={(e) => setOrganizationLabel(e.target.value)}
              className="mt-1 border-white/15 bg-black/30 text-slate-100"
              placeholder="e.g. Circle of Life"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Default &quot;entered by&quot; name
            <Input
              value={defaultEnteredByName}
              onChange={(e) => setDefaultEnteredByName(e.target.value)}
              className="mt-1 border-white/15 bg-black/30 text-slate-100"
              placeholder="Shared activation user or your name"
            />
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
        <span>
          Progress: <strong className="text-white">{stats.answeredRequired}</strong> / {stats.requiredTotal} required
          answered ({stats.pct}%) · {stats.total} questions loaded
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "border-white/20 bg-transparent text-slate-100 hover:bg-white/10",
            )}
          >
            <FileUp className="mr-1.5 h-4 w-4" />
            Upload question pack (JSON)
          </button>
        </div>
      </div>

      {importMessage ? (
        <p className="text-sm text-teal-300" role="status">
          {importMessage}
        </p>
      ) : null}
      {importError ? (
        <p className="text-sm text-rose-300" role="alert">
          {importError}
        </p>
      ) : null}

      <div className="space-y-6">
        {sortedQuestions.map((q) => {
          const r = responsesByQuestionId[q.id];
          const value = r?.value ?? "";
          const confidence: ConfidenceLevel = r?.confidence ?? "best_known";
          const enteredBy = r?.enteredByName ?? defaultEnteredByName;
          return (
            <OnboardingQuestionField
              key={q.id}
              question={q}
              value={value}
              confidence={confidence}
              enteredByName={enteredBy}
              onValueChange={(v) => setResponseValue(q.id, v)}
              onConfidenceChange={(c) => setResponseConfidence(q.id, c)}
              onEnteredByChange={(name) => setEnteredByForQuestion(q.id, name)}
            />
          );
        })}
      </div>
    </div>
  );
}
