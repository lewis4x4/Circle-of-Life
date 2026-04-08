import type { OnboardingQuestion, OnboardingResponse } from "@/lib/onboarding/types";

export interface OnboardingExportInput {
  organizationLabel?: string;
  questions: OnboardingQuestion[];
  responses: Record<string, OnboardingResponse | undefined>;
  exportedAtIso: string;
}

/**
 * Stable, LLM-friendly markdown: machine-readable headings, fenced answers, stable ids.
 */
export function buildOnboardingMarkdownExport(input: OnboardingExportInput): string {
  const { organizationLabel, questions, responses, exportedAtIso } = input;
  const sorted = [...questions].sort((a, b) => {
    const sa = a.sortOrder ?? 999999;
    const sb = b.sortOrder ?? 999999;
    if (sa !== sb) return sa - sb;
    const dept = a.department.localeCompare(b.department);
    if (dept !== 0) return dept;
    return a.id.localeCompare(b.id);
  });

  const answered = questions.filter((q) => {
    const r = responses[q.id];
    return r && r.value.trim().length > 0;
  }).length;

  const lines: string[] = [
    `<!-- haven-onboarding-export format=markdown version=1 -->`,
    ``,
    `# Haven onboarding discovery export`,
    ``,
    `## Document metadata`,
    ``,
    `- **Exported at (UTC):** ${exportedAtIso}`,
    `- **Organization label:** ${organizationLabel?.trim() || "(not set)"}`,
    `- **Total questions:** ${questions.length}`,
    `- **Answered (non-empty):** ${answered}`,
    ``,
    `Use each \`Question id\` as the stable key when mapping to downstream tasks, configuration, or follow-ups.`,
    ``,
    `---`,
    ``,
  ];

  let currentDept = "";
  for (const q of sorted) {
    if (q.department !== currentDept) {
      currentDept = q.department;
      lines.push(`## Department: ${currentDept}`, ``);
    }
    const r = responses[q.id];
    lines.push(`### ${q.id}`, ``);
    lines.push(`- **Prompt:** ${q.prompt}`);
    if (q.helpText?.trim()) {
      lines.push(`- **Why this matters:** ${q.helpText.trim()}`);
    }
    if (q.assignedTo?.trim()) {
      lines.push(`- **Assigned to:** ${q.assignedTo.trim()}`);
    }
    lines.push(`- **Category:** ${q.category ?? "(none)"}`);
    lines.push(`- **Importance:** ${q.importance}`);
    lines.push(`- **Answer type:** ${q.answerType}`);
    lines.push(`- **Required:** ${q.required !== false ? "yes" : "no"}`);
    if (q.options?.length) {
      lines.push(`- **Options:** ${q.options.join(" | ")}`);
    }
    lines.push(``);
    lines.push(`**Answer**`);
    lines.push(``);
    lines.push("```text");
    lines.push((r?.value ?? "").trim() === "" ? "(no answer yet)" : r!.value.trimEnd());
    lines.push("```");
    lines.push(``);
    lines.push(`- **Confidence:** ${r?.confidence ?? "(not set)"}`);
    lines.push(`- **Entered by (attribution):** ${r?.enteredByName?.trim() || "(not set)"}`);
    lines.push(`- **Last updated (UTC):** ${r?.updatedAt ?? "(not set)"}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  return lines.join("\n");
}
