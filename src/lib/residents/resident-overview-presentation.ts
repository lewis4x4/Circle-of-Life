/**
 * Resident overview presentation — factual copy and layout helpers.
 *
 * Does not invent clinical meaning. Empty activity is not a quiet shift.
 * Diagnosis phrases stay as recorded; this module does not reclassify,
 * split, or extra-deduplicate clinical lists.
 */

import { endOfDay, startOfDay, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import { resolveCodeStatusPresentation } from "@/lib/residents/resident-code-status";
import { classifyAnnualReview } from "@/lib/residents/care-plan-annual-review-window";
import { diagnosisDisplayTitle } from "@/lib/residents/clinical-text-format";
import {
  RESIDENT_OVERVIEW_ALLERGIES_NOT_REVIEWED,
  RESIDENT_OVERVIEW_NKDA,
  RESIDENT_OVERVIEW_NO_DATE_COPY,
  RESIDENT_OVERVIEW_NO_DUE_WORK,
  RESIDENT_OVERVIEW_VERIFICATION_PENDING,
} from "@/lib/residents/resident-overview-display-copy";
import type { ResidentOverviewDetail } from "@/lib/residents/resident-detail-overview-load";

export const RESIDENT_OVERVIEW_TZ = "America/New_York";
export const RESIDENT_OVERVIEW_ACTIVITY_DAYS = 7;

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: RESIDENT_OVERVIEW_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatOverviewDayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return dayLabelFormatter.format(parsed);
}

export function formatCodeStatusVerificationLabel(
  verifiedAtIso: string | null | undefined,
  verifiedByName: string | null | undefined,
): { kind: "pending" | "verified"; label: string } {
  const day = formatOverviewDayLabel(verifiedAtIso ?? null);
  if (!day) {
    return { kind: "pending", label: RESIDENT_OVERVIEW_VERIFICATION_PENDING };
  }
  const who = verifiedByName?.trim();
  return {
    kind: "verified",
    label: who ? `Verified ${day} by ${who}` : `Verified ${day}`,
  };
}

export function formatCodeStatusHeadline(
  raw: string | null | undefined,
  verifiedAtIso: string | null | undefined,
  verifiedByName: string | null | undefined,
): { valueLabel: string; verificationLabel: string; headline: string; verificationKind: "pending" | "verified" } {
  const { label: valueLabel } = resolveCodeStatusPresentation(raw ?? null);
  const verification = formatCodeStatusVerificationLabel(verifiedAtIso, verifiedByName);
  return {
    valueLabel,
    verificationLabel: verification.label,
    verificationKind: verification.kind,
    headline: `${valueLabel} · ${verification.label}`,
  };
}

/**
 * Display diagnoses as recorded phrases.
 *
 * Source mapping (inspect, do not "fix" in the UI):
 * - `residents.primary_diagnosis` is free text and often a combined list.
 * - `residents.diagnosis_list` is a separate string array.
 * - The loader concatenates those fields and exact-match-dedupes only.
 *
 * Heuristic category grouping is not applied. Grouping recategorizes clinical
 * text and can place a combined primary string beside the same conditions as
 * individual items. Title-casing is display-only and does not split records.
 */
export function recordedDiagnosisPhrases(rawList: string[]): string[] {
  return rawList.map((phrase) => phrase.trim()).filter(Boolean).map((phrase) => diagnosisDisplayTitle(phrase));
}

export type ResidentOverviewActivityWindow = {
  startUtc: Date;
  endUtc: Date;
  label: string;
};

export function residentOverviewActivityWindow(now: Date = new Date()): ResidentOverviewActivityWindow {
  const zoned = toZonedTime(now, RESIDENT_OVERVIEW_TZ);
  const startZoned = startOfDay(subDays(zoned, RESIDENT_OVERVIEW_ACTIVITY_DAYS - 1));
  const endZoned = endOfDay(zoned);
  const startUtc = fromZonedTime(startZoned, RESIDENT_OVERVIEW_TZ);
  const endUtc = fromZonedTime(endZoned, RESIDENT_OVERVIEW_TZ);
  return {
    startUtc,
    endUtc,
    label: `${formatInTimeZone(startUtc, RESIDENT_OVERVIEW_TZ, "MMM d")} – ${formatInTimeZone(endUtc, RESIDENT_OVERVIEW_TZ, "MMM d, yyyy")}`,
  };
}

export function formatResidentOverviewActivityEmptyCopy(window: ResidentOverviewActivityWindow): string {
  return `No activity recorded for ${window.label}.`;
}

export function isTimestampInActivityWindow(
  iso: string | null | undefined,
  window: ResidentOverviewActivityWindow,
): boolean {
  if (!iso) return true;
  const trimmed = iso.trim();
  if (!trimmed) return true;
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  const parsed = dateOnly
    ? fromZonedTime(`${dateOnly[1]}T12:00:00`, RESIDENT_OVERVIEW_TZ)
    : new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return true;
  const ms = parsed.getTime();
  return ms >= window.startUtc.getTime() && ms <= window.endUtc.getTime();
}

export type OverviewAllergyState = "unreviewed" | "nkda" | "listed";

export function overviewAllergyPresentation(detail: Pick<ResidentOverviewDetail, "allergiesTokens" | "allergyReviewedAt" | "allergyReviewedByName">): {
  state: OverviewAllergyState;
  value: string;
  reviewLabel: string;
} {
  const review = formatCodeStatusVerificationLabel(detail.allergyReviewedAt, detail.allergyReviewedByName);
  const reviewLabel = review.kind === "pending" ? "Review pending" : review.label.replace(/^Verified /, "Reviewed ");

  if (detail.allergiesTokens.length === 0) {
    if (!detail.allergyReviewedAt) {
      return {
        state: "unreviewed",
        value: RESIDENT_OVERVIEW_ALLERGIES_NOT_REVIEWED,
        reviewLabel,
      };
    }
    return {
      state: "nkda",
      value: RESIDENT_OVERVIEW_NKDA,
      reviewLabel,
    };
  }

  return {
    state: "listed",
    value: detail.allergiesTokens.map((token) => diagnosisDisplayTitle(token)).join("; "),
    reviewLabel,
  };
}

export type OverviewAttentionTone = "danger" | "warning";

export type OverviewAttentionItem = {
  id: string;
  title: string;
  detail: string;
  tone: OverviewAttentionTone;
  href?: string;
};

export function buildOverviewAttentionItems(
  detail: ResidentOverviewDetail,
  hrefs: { carePlanHref: string; assessmentsHref: string; profileHref: string },
): OverviewAttentionItem[] {
  const items: OverviewAttentionItem[] = [];

  if (detail.carePlanAnnualDeltaDays != null) {
    const classified = classifyAnnualReview(detail.carePlanAnnualDeltaDays);
    if (classified.kind === "overdue") {
      items.push({
        id: "cp-overdue",
        title: "Annual care plan review",
        detail: `${classified.days} days overdue`,
        tone: "danger",
        href: hrefs.carePlanHref,
      });
    } else if (classified.kind === "dueToday") {
      items.push({
        id: "cp-today",
        title: "Annual care plan review",
        detail: "Due today",
        tone: "danger",
        href: hrefs.carePlanHref,
      });
    } else if (classified.kind === "approaching") {
      items.push({
        id: "cp-soon",
        title: "Annual care plan review",
        detail: `Due in ${classified.days} days`,
        tone: "warning",
        href: hrefs.carePlanHref,
      });
    }
  }

  detail.assessmentsUpcomingJson.forEach((row, index) => {
    const dueIso = row.nextDue;
    if (!dueIso) return;
    const due = new Date(`${dueIso}T12:00:00`);
    if (Number.isNaN(due.getTime())) return;
    const diff = Math.round((due.getTime() - Date.now()) / 86400000);
    if (diff > 30) return;
    const title = diagnosisDisplayTitle(row.assessmentType.replace(/_/g, " ")) || row.assessmentType;
    if (diff < 0) {
      items.push({
        id: `asm-${index}`,
        title,
        detail: `${Math.abs(diff)} days overdue`,
        tone: "danger",
        href: hrefs.assessmentsHref,
      });
      return;
    }
    items.push({
      id: `asm-${index}`,
      title,
      detail: diff === 0 ? "Due today" : `Due in ${diff} days`,
      tone: diff === 0 ? "danger" : "warning",
      href: hrefs.assessmentsHref,
    });
  });

  const allergies = overviewAllergyPresentation(detail);
  if (allergies.state === "unreviewed") {
    items.push({
      id: "allergy-review",
      title: "Allergy review",
      detail: RESIDENT_OVERVIEW_ALLERGIES_NOT_REVIEWED,
      tone: "warning",
      href: hrefs.profileHref,
    });
  }

  const code = formatCodeStatusHeadline(
    detail.codeStatusRaw,
    detail.codeStatusVerifiedAt,
    detail.codeStatusVerifiedByName,
  );
  if (code.valueLabel !== "Not on file" && code.verificationKind === "pending") {
    items.push({
      id: "code-verify",
      title: "Code status verification",
      detail: code.verificationLabel,
      tone: "warning",
      href: hrefs.profileHref,
    });
  }

  const order: Record<OverviewAttentionTone, number> = { danger: 0, warning: 1 };
  items.sort((a, b) => order[a.tone] - order[b.tone]);
  return items;
}

export function overviewAttentionEmptyCopy(): string {
  return RESIDENT_OVERVIEW_NO_DUE_WORK;
}

export type OverviewCompletenessItem = {
  id: string;
  label: string;
  href?: string;
};

export function buildOverviewCompletenessItems(
  detail: ResidentOverviewDetail,
  profileHref: string,
): OverviewCompletenessItem[] {
  const items: OverviewCompletenessItem[] = [];
  const code = resolveCodeStatusPresentation(detail.codeStatusRaw);

  if (code.label === "Not on file") {
    items.push({ id: "code-missing", label: "Code status not on file", href: profileHref });
  }
  if (!detail.advanceDirectiveOnFile) {
    items.push({ id: "dnh-missing", label: "Do-not-hospitalize notation not on file", href: profileHref });
  }
  if (!detail.polstMolstRawStatus || detail.polstMolstRawStatus === "none") {
    items.push({ id: "polst-missing", label: "POLST / MOLST not on file", href: profileHref });
  }
  if (!detail.diagnosesReviewedAt) {
    items.push({
      id: "dx-unreviewed",
      label: detail.diagnosisRawList.length ? "Diagnoses awaiting review" : "Diagnoses not documented",
      href: profileHref,
    });
  }
  if (!detail.dietOrder) {
    items.push({ id: "diet-unreviewed", label: "Diet order not reviewed", href: profileHref });
  }
  if (detail.unitName === "No unit linked") {
    items.push({ id: "unit-missing", label: "Unit not linked" });
  }
  if (detail.roomLabel === "No bed link") {
    items.push({ id: "bed-missing", label: "Room and bed not linked" });
  }
  if (!detail.primaryPhysicianName) {
    items.push({ id: "pcp-missing", label: "Primary care physician not on file", href: profileHref });
  }
  return items;
}

export function formatOverviewIdentitySubtitle(detail: Pick<ResidentOverviewDetail, "roomLabel" | "unitName" | "admissionLabel">): string {
  const parts = [`Room ${detail.roomLabel}`];
  if (detail.unitName && detail.unitName !== "No unit linked") {
    parts.push(detail.unitName);
  }
  parts.push(`Admitted ${detail.admissionLabel}`);
  return parts.join(" · ");
}

export function formatOverviewAgeDobLine(
  detail: Pick<ResidentOverviewDetail, "ageYears" | "dobLabel" | "gender">,
  genderLabel: string,
): string {
  const age = detail.ageYears != null ? `Age ${detail.ageYears}` : "Age pending";
  const born =
    !detail.dobLabel || detail.dobLabel === RESIDENT_OVERVIEW_NO_DATE_COPY
      ? `Born ${RESIDENT_OVERVIEW_NO_DATE_COPY}`
      : `Born ${detail.dobLabel}`;
  return `${age} · ${born} · ${genderLabel}`;
}
