import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  binderEvidenceDateWindow,
  fetchBinderEvidence,
} from "./survey-binder";

describe("binderEvidenceDateWindow", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("anchors today and +60 on the Eastern calendar, not UTC ISO slice", () => {
    const window = binderEvidenceDateWindow(eightOhFivePmEt);

    expect(window.todayIso).toBe("2026-08-20");
    expect(window.todayIso).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");

    expect(window.in60Iso).toBe("2026-10-19");
    expect(window.in60Iso).not.toBe(
      new Date(eightOhFivePmEt.getTime() + 60 * 86400 * 1000).toISOString().slice(0, 10),
    );
  });

  it("uses the Eastern calendar year for in-services YTD, not UTC getFullYear", () => {
    /** 9:30 PM Eastern on 2025-12-31 — still 2025 locally while UTC is already 2026-01-01. */
    const newYearsEveEt = new Date("2025-12-31T21:30:00-05:00");

    const window = binderEvidenceDateWindow(newYearsEveEt);

    expect(window.todayIso).toBe("2025-12-31");
    expect(window.yearStartIso).toBe("2025-01-01");
    expect(window.yearStartIso).not.toBe("2026-01-01");
    expect(newYearsEveEt.getUTCFullYear()).toBe(2026);
  });
});

describe("fetchBinderEvidence", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4). */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("queries expiring-soon and drills-due windows on the Eastern calendar after 8pm ET", async () => {
    const queryLog: Array<{ table: string; column?: string; gte?: string; lte?: string }> = [];

    const supabase = {
      from(table: string) {
        const state: { table: string; column?: string; gte?: string; lte?: string } = { table };
        queryLog.push(state);
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          is() {
            return chain;
          },
          gte(column: string, value: string) {
            state.column = column;
            state.gte = value;
            return chain;
          },
          lte(column: string, value: string) {
            state.lte = value;
            return chain;
          },
          order() {
            return chain;
          },
          limit() {
            return chain;
          },
          then(
            resolve: (value: { data: unknown[] | null; count: number | null; error: null }) => void,
            reject?: (reason?: unknown) => void,
          ) {
            try {
              if (table === "facility_survey_history") {
                resolve({ data: [], count: null, error: null });
              } else {
                resolve({ data: null, count: 0, error: null });
              }
            } catch (error) {
              reject?.(error);
            }
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;

    await fetchBinderEvidence(supabase, "facility-alpha-001", eightOhFivePmEt);

    const expiring = queryLog.find(
      (q) => q.table === "facility_documents" && q.column === "expiration_date",
    );
    expect(expiring?.gte).toBe("2026-08-20");
    expect(expiring?.lte).toBe("2026-10-19");
    expect(expiring?.gte).not.toBe("2026-08-21");

    const drills = queryLog.find(
      (q) => q.table === "emergency_checklist_items" && q.column === "next_due_date",
    );
    expect(drills?.gte).toBe("2026-08-20");
    expect(drills?.lte).toBe("2026-10-19");

    const inservices = queryLog.find(
      (q) => q.table === "inservice_log_sessions" && q.column === "session_date",
    );
    expect(inservices?.gte).toBe("2026-01-01");
    expect(inservices?.lte).toBe("2999-12-31");
  });
});
