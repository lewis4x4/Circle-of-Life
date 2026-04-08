import { create } from "zustand";

import { getAppRoleFromClaims, isOrgAdminAppRole } from "@/lib/auth/app-role";
import { buildOnboardingMarkdownExport } from "@/lib/onboarding/export-markdown";
import { onboardingImportFileSchemaV1 } from "@/lib/onboarding/import-schema";
import { COL_DEFAULT_ORGANIZATION_ID } from "@/lib/onboarding/constants";
import {
  exportAllAsMarkdown,
  fetchQuestions,
  fetchResponses,
  importQuestions,
  upsertResponse,
} from "@/lib/onboarding/supabase-queries";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import type { ConfidenceLevel, OnboardingQuestion, OnboardingResponse } from "@/lib/onboarding/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEBOUNCE_MS = 500;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearAllOnboardingDebounceTimers() {
  for (const id of debounceTimers.values()) {
    clearTimeout(id);
  }
  debounceTimers.clear();
}

function indexQuestions(list: OnboardingQuestion[]): Record<string, OnboardingQuestion> {
  const out: Record<string, OnboardingQuestion> = {};
  for (const q of list) {
    out[q.id] = q;
  }
  return out;
}

function scheduleDebounced(key: string, fn: () => void) {
  const prev = debounceTimers.get(key);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      fn();
    }, DEBOUNCE_MS),
  );
}

export type OnboardingHydration = "idle" | "loading" | "ready" | "error";
export type OnboardingSaveStatus = "idle" | "saving" | "saved" | "error";

interface OnboardingState {
  hydration: OnboardingHydration;
  saveStatus: OnboardingSaveStatus;
  saveError: string | null;
  loadError: string | null;
  organizationId: string | null;
  userId: string | null;
  /** JWT `app_metadata.app_role` (empty if unknown). */
  appRole: string;
  /** True when `app_role` is owner or org_admin (export / import controls). */
  isOrgAdmin: boolean;
  questionsById: Record<string, OnboardingQuestion>;
  responsesByQuestionId: Record<string, OnboardingResponse>;
  organizationLabel: string;
  defaultEnteredByName: string;
  hydrate: () => Promise<void>;
  setOrganizationLabel: (v: string) => void;
  setDefaultEnteredByName: (v: string) => void;
  setResponseValue: (questionId: string, value: string) => void;
  setResponseConfidence: (questionId: string, confidence: ConfidenceLevel) => void;
  setEnteredByForQuestion: (questionId: string, name: string) => void;
  importQuestionFileJson: (
    jsonText: string,
  ) => Promise<{ ok: true; added: number; updated: number } | { ok: false; error: string }>;
  resetWorkspace: () => Promise<void>;
  /** Clears client state after `supabase.auth.signOut()` so no stale answers stay in memory. */
  clearAfterSignOut: () => void;
  exportMarkdown: () => string;
  exportMarkdownFromDb: () => Promise<string>;
}

async function resolveOrganizationId(
  supabase: SupabaseClient<Database>,
  userId: string,
  appRole: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  let organizationId = profile?.organization_id ?? null;
  if (!organizationId && appRole === "onboarding") {
    organizationId = COL_DEFAULT_ORGANIZATION_ID;
  }
  return organizationId;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => {
  const persistResponse = async (questionId: string) => {
    const state = get();
    if (state.hydration !== "ready" || !state.organizationId) return;
    const r = state.responsesByQuestionId[questionId];
    if (!r) return;
    if (!isBrowserSupabaseConfigured()) return;
    const supabase = createClient();
    set({ saveStatus: "saving", saveError: null });
    try {
      await upsertResponse(supabase, {
        organizationId: state.organizationId,
        questionId,
        value: r.value,
        confidence: r.confidence,
        enteredByName: r.enteredByName,
        enteredByUserId: state.userId,
      });
      set({ saveStatus: "saved" });
      setTimeout(() => set({ saveStatus: "idle" }), 1600);
    } catch (e) {
      set({
        saveStatus: "error",
        saveError: e instanceof Error ? e.message : "Save failed",
      });
    }
  };

  return {
    hydration: "idle",
    saveStatus: "idle",
    saveError: null,
    loadError: null,
    organizationId: null,
    userId: null,
    appRole: "",
    isOrgAdmin: false,
    questionsById: {},
    responsesByQuestionId: {},
    organizationLabel: "",
    defaultEnteredByName: "",

    hydrate: async () => {
      if (!isBrowserSupabaseConfigured()) {
        set({ hydration: "error", loadError: "Supabase is not configured for this environment." });
        return;
      }
      const supabase = createClient();
      set({ hydration: "loading", loadError: null });
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        set({ hydration: "error", loadError: "Sign in to load shared onboarding answers.", appRole: "", isOrgAdmin: false });
        return;
      }
      const userId = session.user.id;
      const appRole = getAppRoleFromClaims(session.user);
      set({ appRole, isOrgAdmin: isOrgAdminAppRole(appRole) });
      const organizationId = await resolveOrganizationId(supabase, userId, appRole);
      if (!organizationId) {
        set({
          hydration: "error",
          loadError: "No organization is assigned to your profile. Ask an administrator to link your account.",
        });
        return;
      }

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();

      try {
        const questions = await fetchQuestions(supabase);
        const responses = await fetchResponses(supabase, organizationId);
        set({
          hydration: "ready",
          questionsById: indexQuestions(questions),
          responsesByQuestionId: responses,
          organizationId,
          userId,
          defaultEnteredByName: profile?.full_name?.trim() ?? "",
          loadError: null,
        });
      } catch (e) {
        set({
          hydration: "error",
          loadError: e instanceof Error ? e.message : "Failed to load onboarding data from Supabase.",
        });
      }
    },

    setOrganizationLabel: (organizationLabel) => set({ organizationLabel }),
    setDefaultEnteredByName: (defaultEnteredByName) => set({ defaultEnteredByName }),

    setResponseValue: (questionId, value) => {
      set((state) => {
        const prev = state.responsesByQuestionId[questionId];
        const name = prev?.enteredByName?.trim() || state.defaultEnteredByName.trim();
        const next: OnboardingResponse = {
          value,
          confidence: prev?.confidence ?? "best_known",
          enteredByName: name,
          updatedAt: new Date().toISOString(),
          enteredByUserId: state.userId,
        };
        return {
          responsesByQuestionId: {
            ...state.responsesByQuestionId,
            [questionId]: next,
          },
        };
      });
      scheduleDebounced(`rq-${questionId}`, () => {
        void persistResponse(questionId);
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
                enteredByUserId: state.userId,
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
      scheduleDebounced(`rq-${questionId}`, () => {
        void persistResponse(questionId);
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
          enteredByUserId: state.userId,
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
      scheduleDebounced(`rq-${questionId}`, () => {
        void persistResponse(questionId);
      });
    },

    importQuestionFileJson: async (jsonText) => {
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
      if (!isBrowserSupabaseConfigured()) {
        return { ok: false, error: "Supabase is not configured." };
      }
      const supabase = createClient();
      const state = get();
      let added = 0;
      let updated = 0;
      for (const q of incoming) {
        if (state.questionsById[q.id]) updated += 1;
        else added += 1;
      }
      try {
        await importQuestions(supabase, incoming);
        const questions = await fetchQuestions(supabase);
        set({ questionsById: indexQuestions(questions) });
        return { ok: true, added, updated };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
      }
    },

    resetWorkspace: async () => {
      await get().hydrate();
    },

    clearAfterSignOut: () => {
      clearAllOnboardingDebounceTimers();
      set({
        hydration: "idle",
        saveStatus: "idle",
        saveError: null,
        loadError: null,
        organizationId: null,
        userId: null,
        appRole: "",
        isOrgAdmin: false,
        questionsById: {},
        responsesByQuestionId: {},
        organizationLabel: "",
        defaultEnteredByName: "",
      });
    },

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

    exportMarkdownFromDb: async () => {
      const state = get();
      if (!state.organizationId || !isBrowserSupabaseConfigured()) {
        return get().exportMarkdown();
      }
      const supabase = createClient();
      return exportAllAsMarkdown(supabase, state.organizationId, state.organizationLabel);
    },
  };
});
