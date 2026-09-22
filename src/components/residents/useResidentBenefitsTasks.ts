"use client";

import { useEffect, useState } from "react";

import { caseFlags, programChoices, renewalWarningDays } from "@/components/benefits/BenefitsQueue";
import { benefitsFetch } from "@/components/benefits/benefits-ui";
import type { BenefitsCaseList, BenefitsRulesList } from "@/lib/benefits/contracts";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { benefitsTaskItems, type TaskItem } from "@/lib/residents/resident-task-clocks";

/**
 * COL-599: a resident's open benefits cases as overview tasks.
 *
 * Benefits tables are reachable only through the benefits API (migration 445
 * revokes direct access), so this reads the same endpoints the benefits queue
 * does and applies the queue's own `caseFlags` with the organization's
 * `renewal.warning_days` rule. A role without benefits access gets a 403 and
 * the overview simply shows no benefits tasks — it is not an error on this page.
 */
export function useResidentBenefitsTasks(residentId: string): TaskItem[] {
  const [items, setItems] = useState<TaskItem[]>([]);

  useEffect(() => {
    if (!UUID_STRING_RE.test(residentId)) return;
    let live = true;
    const query = new URLSearchParams({ resident_id: residentId, limit: "20" });
    Promise.all([
      benefitsFetch<BenefitsCaseList>(`/api/admin/benefits/cases?${query}`),
      benefitsFetch<BenefitsRulesList>("/api/admin/benefits/rules").catch(() => null),
    ])
      .then(([list, rules]) => {
        if (!live) return;
        const today = todayFacilityDateIso();
        const warningDays = renewalWarningDays(rules);
        const open = (list?.cases ?? []).filter((item) => item.status !== "closed");
        setItems(
          benefitsTaskItems(
            open.map((item) => ({
              id: item.id,
              programLabel: programChoices.find((choice) => choice.value === item.program)?.label ?? "Benefits",
              flags: caseFlags(item, today, warningDays),
            })),
          ),
        );
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [residentId]);

  return items;
}
