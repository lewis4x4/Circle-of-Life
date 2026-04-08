#!/usr/bin/env npx tsx
/**
 * Generates SQL INSERT for onboarding_questions from seed-questions.ts (run after editing seed data).
 * Usage: npx tsx scripts/emit-onboarding-seed-sql.ts
 */
import { DEFAULT_ONBOARDING_QUESTIONS } from "../src/lib/onboarding/seed-questions";

function esc(s: string) {
  return s.replace(/'/g, "''");
}

const rows = DEFAULT_ONBOARDING_QUESTIONS.map((q) => {
  const options = q.options && q.options.length > 0 ? `'${esc(JSON.stringify(q.options))}'::jsonb` : "NULL::jsonb";
  const help = q.helpText != null ? `'${esc(q.helpText)}'` : "NULL";
  const assigned = q.assignedTo != null ? `'${esc(q.assignedTo)}'` : "NULL";
  const cat = q.category != null ? `'${esc(q.category)}'` : "NULL";
  const sort = q.sortOrder != null ? String(q.sortOrder) : "NULL";
  const req = q.required === false ? "false" : "true";
  return `('${esc(q.id)}', '${esc(q.prompt)}', ${help}, ${assigned}, '${esc(q.department)}', ${cat}, '${q.importance}', '${q.answerType}', ${req}, ${options}, ${sort})`;
});

console.log(`INSERT INTO public.onboarding_questions (
  id, prompt, help_text, assigned_to, department, category, importance, answer_type, required, options, sort_order
) VALUES
${rows.join(",\n")}
ON CONFLICT (id) DO NOTHING;`);
