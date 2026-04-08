import type { SupabaseClient } from "@supabase/supabase-js";

import { buildOnboardingMarkdownExport } from "@/lib/onboarding/export-markdown";
import type { Database, Json } from "@/types/database";
import type {
  AnswerType,
  ConfidenceLevel,
  ImportanceLevel,
  OnboardingQuestion,
  OnboardingResponse,
} from "@/lib/onboarding/types";

type QuestionRow = Database["public"]["Tables"]["onboarding_questions"]["Row"];
type ResponseRow = Database["public"]["Tables"]["onboarding_responses"]["Row"];

function parseOptions(json: Json | null): string[] | undefined {
  if (json === null || json === undefined) return undefined;
  if (!Array.isArray(json)) return undefined;
  const out: string[] = [];
  for (const x of json) {
    if (typeof x === "string") out.push(x);
  }
  return out.length > 0 ? out : undefined;
}

export function mapQuestionRow(row: QuestionRow): OnboardingQuestion {
  return {
    id: row.id,
    prompt: row.prompt,
    helpText: row.help_text ?? undefined,
    assignedTo: row.assigned_to ?? undefined,
    department: row.department,
    category: row.category ?? undefined,
    importance: row.importance as ImportanceLevel,
    answerType: row.answer_type as AnswerType,
    required: row.required,
    options: parseOptions(row.options),
    sortOrder: row.sort_order ?? undefined,
  };
}

export function mapResponseRow(row: ResponseRow): OnboardingResponse {
  return {
    value: row.value,
    confidence: row.confidence as ConfidenceLevel,
    enteredByName: row.entered_by_name,
    updatedAt: row.updated_at,
    enteredByUserId: row.entered_by_user_id,
  };
}

export async function fetchQuestions(supabase: SupabaseClient<Database>): Promise<OnboardingQuestion[]> {
  const { data, error } = await supabase.from("onboarding_questions").select("*");

  if (error) throw error;
  const mapped = (data ?? []).map(mapQuestionRow);
  mapped.sort((a, b) => {
    const sa = a.sortOrder ?? 999999;
    const sb = b.sortOrder ?? 999999;
    if (sa !== sb) return sa - sb;
    const d = a.department.localeCompare(b.department);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  return mapped;
}

export async function fetchResponses(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<Record<string, OnboardingResponse>> {
  const { data, error } = await supabase.from("onboarding_responses").select("*").eq("organization_id", organizationId);

  if (error) throw error;
  const out: Record<string, OnboardingResponse> = {};
  for (const row of data ?? []) {
    out[row.question_id] = mapResponseRow(row);
  }
  return out;
}

export async function upsertResponse(
  supabase: SupabaseClient<Database>,
  args: {
    organizationId: string;
    questionId: string;
    value: string;
    confidence: ConfidenceLevel;
    enteredByName: string;
    enteredByUserId: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("onboarding_responses").upsert(
    {
      organization_id: args.organizationId,
      question_id: args.questionId,
      value: args.value,
      confidence: args.confidence,
      entered_by_name: args.enteredByName,
      entered_by_user_id: args.enteredByUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,question_id" },
  );

  if (error) throw error;
}

export async function importQuestions(
  supabase: SupabaseClient<Database>,
  questions: OnboardingQuestion[],
): Promise<void> {
  const rows = questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    help_text: q.helpText ?? null,
    assigned_to: q.assignedTo ?? null,
    department: q.department,
    category: q.category ?? null,
    importance: q.importance,
    answer_type: q.answerType,
    required: q.required !== false,
    options: q.options && q.options.length > 0 ? (q.options as unknown as Json) : null,
    sort_order: q.sortOrder ?? null,
  }));

  const { error } = await supabase.from("onboarding_questions").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export async function exportAllAsMarkdown(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  organizationLabel: string,
): Promise<string> {
  const questions = await fetchQuestions(supabase);
  const responses = await fetchResponses(supabase, organizationId);
  return buildOnboardingMarkdownExport({
    organizationLabel,
    questions,
    responses,
    exportedAtIso: new Date().toISOString(),
  });
}
