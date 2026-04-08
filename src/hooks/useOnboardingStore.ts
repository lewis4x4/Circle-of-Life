import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { buildOnboardingMarkdownExport } from "@/lib/onboarding/export-markdown";
import { onboardingImportFileSchemaV1 } from "@/lib/onboarding/import-schema";
import { DEFAULT_ONBOARDING_QUESTIONS } from "@/lib/onboarding/seed-questions";
import type { OnboardingQuestion, OnboardingResponse, ConfidenceLevel } from "@/lib/onboarding/types";

const STORAGE_KEY = "haven-onboarding-command-center-v1";

function indexQuestions(list: OnboardingQuestion[]): Record<string, OnboardingQuestion> {
  const out: Record<string, OnboardingQuestion> = {};
  for (const q of list) {
    out[q.id] = q;
  }
  return out;
}

function mergeQuestionPacks(
  existing: Record<string, OnboardingQuestion>,
  incoming: OnboardingQuestion[],
): Record<string, OnboardingQuestion> {
  const next = { ...existing };
  for (const q of incoming) {
    next[q.id] = { ...next[q.id], ...q };
  }
  return next;
}

interface OnboardingState {
  organizationLabel: string;
  defaultEnteredByName: string;
  questionsById: Record<string, OnboardingQuestion>;
  responsesByQuestionId: Record<string, OnboardingResponse>;
  setOrganizationLabel: (v: string) => void;
  setDefaultEnteredByName: (v: string) => void;
  setResponseValue: (questionId: string, value: string) => void;
  setResponseConfidence: (questionId: string, confidence: ConfidenceLevel) => void;
  setEnteredByForQuestion: (questionId: string, name: string) => void;
  importQuestionFileJson: (jsonText: string) => { ok: true; added: number; updated: number } | { ok: false; error: string };
  resetWorkspace: () => void;
  exportMarkdown: () => string;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      organizationLabel: "",
      defaultEnteredByName: "",
      questionsById: indexQuestions(DEFAULT_ONBOARDING_QUESTIONS),
      responsesByQuestionId: {},

      setOrganizationLabel: (organizationLabel) => set({ organizationLabel }),
      setDefaultEnteredByName: (defaultEnteredByName) => set({ defaultEnteredByName }),

      setResponseValue: (questionId, value) => {
        const name = get().defaultEnteredByName.trim();
        set((state) => {
          const prev = state.responsesByQuestionId[questionId];
          const enteredByName = prev?.enteredByName?.trim() || name || "";
          const next: OnboardingResponse = {
            value,
            confidence: prev?.confidence ?? "best_known",
            enteredByName,
            updatedAt: new Date().toISOString(),
          };
          return {
            responsesByQuestionId: {
              ...state.responsesByQuestionId,
              [questionId]: next,
            },
          };
        });
      },

      setResponseConfidence: (questionId, confidence) => {
        set((state) => {
          const prev = state.responsesByQuestionId[questionId];
          if (!prev) {
            const enteredByName = state.defaultEnteredByName.trim();
            return {
              responsesByQuestionId: {
                ...state.responsesByQuestionId,
                [questionId]: {
                  value: "",
                  confidence,
                  enteredByName,
                  updatedAt: new Date().toISOString(),
                },
              },
            };
          }
          return {
            responsesByQuestionId: {
              ...state.responsesByQuestionId,
              [questionId]: {
                ...prev,
                confidence,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      setEnteredByForQuestion: (questionId, enteredByName) => {
        set((state) => {
          const prev = state.responsesByQuestionId[questionId];
          const base: OnboardingResponse = prev ?? {
            value: "",
            confidence: "best_known",
            enteredByName: "",
            updatedAt: new Date().toISOString(),
          };
          return {
            responsesByQuestionId: {
              ...state.responsesByQuestionId,
              [questionId]: {
                ...base,
                enteredByName: enteredByName.trim(),
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      importQuestionFileJson: (jsonText) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          return { ok: false, error: "File is not valid JSON." };
        }
        const result = onboardingImportFileSchemaV1.safeParse(parsed);
        if (!result.success) {
          const msg = result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
          return { ok: false, error: msg };
        }
        const incoming = result.data.questions;
        const state = get();
        let added = 0;
        let updated = 0;
        for (const q of incoming) {
          if (state.questionsById[q.id]) updated += 1;
          else added += 1;
        }
        set({
          questionsById: mergeQuestionPacks(state.questionsById, incoming),
        });
        return { ok: true, added, updated };
      },

      resetWorkspace: () =>
        set({
          organizationLabel: "",
          defaultEnteredByName: "",
          questionsById: indexQuestions(DEFAULT_ONBOARDING_QUESTIONS),
          responsesByQuestionId: {},
        }),

      exportMarkdown: () => {
        const state = get();
        const questions = Object.values(state.questionsById);
        return buildOnboardingMarkdownExport({
          organizationLabel: state.organizationLabel,
          questions,
          responses: state.responsesByQuestionId,
          exportedAtIso: new Date().toISOString(),
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        organizationLabel: state.organizationLabel,
        defaultEnteredByName: state.defaultEnteredByName,
        questionsById: state.questionsById,
        responsesByQuestionId: state.responsesByQuestionId,
      }),
    },
  ),
);
