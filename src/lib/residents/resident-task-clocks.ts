import { FORM_1823_MAX_AGE_YEARS, form1823AgeState } from "@/lib/care-plans/form-1823-alignment";
import type {
  ResidentForm1823Clock,
  ResidentIncidentFollowupClock,
} from "@/lib/residents/resident-detail-overview-load";

/**
 * COL-599: "Tasks and due dates" covered two of the record's clocks — the
 * annual care-plan review and assessment due dates. These are the others the
 * record actually carries a date for.
 *
 * Every task here comes from a recorded date and an existing rule. None of
 * them adds a warning window of its own: a Form 1823 turns red when the
 * record's own expiration date or the statutory three-year ceiling
 * (`form1823AgeState`) is breached, an incident follow-up when its `due_at`
 * (set from `incident_followup_protocols`) passes, and a benefits case uses
 * the organization's `renewal.warning_days` rule through the benefits API.
 *
 * Not here, on purpose — the record has no date to read:
 * - trust statements (FS 429.27): deferred by migration 456 to a COL-540 child;
 * - a periodic medication regimen review: no such record exists;
 * - "monthly Medicaid verification" (AL-M12): its meaning is unconfirmed
 *   (`finance-source-map.ts`), so nothing may stand in for it.
 */

export type TaskTone = "danger" | "warning" | "muted";

export type TaskItem = { id: string; title: string; tone: TaskTone; sub: string; href: string };

const TONE_ORDER: Record<TaskTone, number> = { danger: 0, warning: 1, muted: 2 };

/** Danger first, then warning, then the rest; stable within a tone. */
export function sortTaskItems(items: TaskItem[]): TaskItem[] {
  return [...items].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

function dayLabel(isoDay: string | null): string | null {
  if (!isoDay) return null;
  const d = new Date(`${isoDay.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
}

/**
 * The Form 1823 clock. `undefined` means the records could not be read, and
 * produces no task — never a false "none on file".
 */
export function form1823TaskItems(
  form: ResidentForm1823Clock | null | undefined,
  today: string,
  href: string,
): TaskItem[] {
  if (form === undefined) return [];
  if (form === null) {
    return [
      {
        id: "f1823-none",
        title: "No Form 1823 on file",
        tone: "warning",
        sub: "The physician's report is the admission document; none is recorded for this resident",
        href,
      },
    ];
  }
  if (form.status === "renewal_due") {
    return [
      {
        id: "f1823-renewal",
        title: "Form 1823 renewal due",
        tone: "danger",
        sub: "Marked for a new physician's report (for example after a hospital return)",
        href,
      },
    ];
  }
  if (form.status === "pending") {
    return [{ id: "f1823-pending", title: "Form 1823 requested", tone: "warning", sub: "Physician's report not yet received", href }];
  }
  const state = form.status === "expired" ? "expired" : form1823AgeState(form.examDate, form.expirationDate, today);
  if (state === "expired") {
    const on = dayLabel(form.expirationDate);
    return [{ id: "f1823-expired", title: "Form 1823 expired", tone: "danger", sub: on ? `Expired ${on}` : "Marked expired", href }];
  }
  if (state === "over_age") {
    return [
      {
        id: "f1823-over-age",
        title: "Form 1823 exam is out of date",
        tone: "danger",
        sub: `Exam ${dayLabel(form.examDate) ?? "date not recorded"} is older than ${FORM_1823_MAX_AGE_YEARS} years`,
        href,
      },
    ];
  }
  if (state === "unknown") {
    return [{ id: "f1823-no-exam", title: "Form 1823 exam date not recorded", tone: "warning", sub: "Its age cannot be checked", href }];
  }
  const expires = dayLabel(form.expirationDate);
  return [
    {
      id: "f1823-current",
      title: "Form 1823",
      tone: "muted",
      sub: expires ? `Expires ${expires}` : `Exam ${dayLabel(form.examDate)} · no expiration date recorded`,
      href,
    },
  ];
}

function followupTitle(taskType: string): string {
  const words = taskType.replace(/_/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Incident follow-up";
}

function instantLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Open incident follow-ups: overdue once `due_at` has passed, otherwise listed with their due time. */
export function incidentFollowupTaskItems(rows: ResidentIncidentFollowupClock[], now: Date = new Date()): TaskItem[] {
  return rows.map((row) => {
    const due = new Date(row.dueAt).getTime();
    const overdue = !Number.isNaN(due) && due < now.getTime();
    const at = instantLabel(row.dueAt) ?? row.dueAt;
    return {
      id: `fu-${row.id}`,
      title: `${followupTitle(row.taskType)} (incident follow-up)`,
      tone: overdue ? "danger" : "muted",
      sub: overdue ? `Overdue since ${at}` : `Due ${at}`,
      href: `/admin/incidents/${row.incidentId}`,
    };
  });
}

/** One benefits flag as the benefits queue computes it (`caseFlags`). */
export type BenefitsClockFlag = { key: string; label: string; tone: "urgent" | "warn" | "info" };

/**
 * A benefits case's dated flags — overdue step and renewal inside the
 * organization's warning window. Only the dated flags become tasks; "resident
 * moved" and the like are not due dates.
 */
export function benefitsTaskItems(
  cases: Array<{ id: string; programLabel: string; flags: BenefitsClockFlag[] }>,
): TaskItem[] {
  const items: TaskItem[] = [];
  for (const item of cases) {
    for (const flag of item.flags) {
      if (flag.key !== "overdue" && flag.key !== "due-soon" && flag.key !== "renewal") continue;
      items.push({
        id: `bn-${item.id}-${flag.key}`,
        title: flag.key === "renewal" ? `${item.programLabel} renewal` : `${item.programLabel} case step`,
        tone: flag.tone === "urgent" ? "danger" : "warning",
        sub: flag.label,
        href: `/admin/benefits/${item.id}`,
      });
    }
  }
  return items;
}
