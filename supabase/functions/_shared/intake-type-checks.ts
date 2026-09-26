/**
 * intake-type-checks: turns Jev's answers into reviewer checks, and runs the
 * per-type CODE checks (dates, counts, identity) for Document Intake
 * (COL-771, DI-09).
 *
 * Jev judges; code decides. Every date window, count and identifier
 * comparison is here, never in a question. Constants restated from src/lib are
 * pinned by src/lib/document-intake/type-checks-drift.test.ts.
 */

import type { JevAnswer, ProposalCheck } from "./document-intake-contract.ts";
import {
  type AnswerRule,
  answerRules,
  buildIntakeQuestions,
  DEFAULT_CHOICE_MIN_PROBABILITY,
  DEFAULT_NOUL_BAND,
  type Evidence,
} from "./intake-type-questions.ts";

// ── Rule constants (restated; drift-tested) ─────────────────────────────────

/** src/lib/admissions/reassessment.ts MEDICAL_EXAM_PRIOR_DAYS */
export const MEDICAL_EXAM_PRIOR_DAYS = 60;
/** src/lib/admissions/reassessment.ts MEDICAL_EXAM_POST_DAYS */
export const MEDICAL_EXAM_POST_DAYS = 30;
/** src/lib/admissions/form-1823-renewal.ts defaultForm1823Expiration (BH-6) */
export const FORM_1823_DEFAULT_VALID_DAYS = 365;
/** CDC: a tuberculin skin test is read 48 to 72 hours after placement. */
export const TST_READ_MIN_DAYS = 2;
export const TST_READ_MAX_DAYS = 3;
/** Display nudge only: a dated obligation this close gets a reviewer warning. */
export const SOON_DAYS = 14;
/** Vendor COI general liability each-occurrence minimum, in cents. null = no check (TBD, Brian). */
export const VENDOR_COI_MIN_GL_EACH_OCCURRENCE_CENTS: number | null = null;

// ── Types ───────────────────────────────────────────────────────────────────

export type Warning = { code: string; message: string };

export type CheckContext = {
  /** Local calendar date, America/New_York. */
  today: string;
  /** Pages in the stored file. */
  pageCount: number | null;
  /** Reader's top-level expiration_date. */
  expirationDate: string | null;
  /** Reader's subject_hints.date_of_birth. */
  readerDob: string | null;
  /** The proposed resident (after Jev or code picked one), else null. */
  resident: { date_of_birth: string | null; admission_date: string | null } | null;
  /** The item's facility. */
  facility: { ahca_license_number: string | null; ahca_license_expiration: string | null; licensed_beds: number | null } | null;
  /** Jev answers as returned ({} when Jev did not run). */
  answers: Record<string, JevAnswer>;
};

// ── Date helpers (calendar dates, UTC arithmetic) ───────────────────────────

function toUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** b minus a, in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

function str(e: Evidence, key: string): string | null {
  const v = e[key];
  return typeof v === "string" ? v : null;
}

function int(e: Evidence, key: string): number | null {
  const v = e[key];
  return typeof v === "number" ? v : null;
}

function list(e: Evidence, key: string): string[] {
  const v = e[key];
  return Array.isArray(v) ? v : [];
}

// ── Jev answers -> checks ───────────────────────────────────────────────────

export type Outcome = { option: string | null; p: number | null };

/** yes / no / unknown for a noul; the winning option (or null) for a choice. */
export function answerOutcome(answer: JevAnswer | undefined, rule: AnswerRule | undefined): Outcome {
  if (!answer) return { option: null, p: null };
  if (answer.type === "noul" && typeof answer.noul === "number") {
    const band = (rule?.kind === "noul" ? rule.band : undefined) ?? DEFAULT_NOUL_BAND;
    const option = answer.noul >= band.high ? "yes" : answer.noul <= band.low ? "no" : "unknown";
    return { option, p: answer.noul };
  }
  if (answer.type === "choice" && typeof answer.choice === "string") {
    const p = answer.probabilities?.[answer.choice] ?? null;
    const min = (rule?.kind === "choice" ? rule.min_probability : undefined) ?? DEFAULT_CHOICE_MIN_PROBABILITY;
    return { option: p !== null && p >= min ? answer.choice : null, p };
  }
  return { option: null, p: null };
}

function round2(p: number | null): string {
  return p === null ? "n/a" : p.toFixed(2);
}

/**
 * Checks and reviewer notes from Jev's answers for one type. Check codes are
 * `jev_<question id>`; the accuracy report joins on that. Probabilities are
 * shown as Jev's own numbers, never as "percent correct".
 */
export function jevChecks(code: string, label: string, answers: Record<string, JevAnswer>): { checks: ProposalCheck[]; warnings: Warning[] } {
  const rules = answerRules(code);
  const questions = buildIntakeQuestions({ code, label, candidates: [] });
  const checks: ProposalCheck[] = [];
  const warnings: Warning[] = [];

  for (const [id, rule] of Object.entries(rules)) {
    const answer = answers[id];
    if (!answer) continue;
    if (rule.when) {
      const gate = answerOutcome(answers[rule.when.question], rules[rule.when.question]);
      if (gate.option === null || !rule.when.in.includes(gate.option)) continue;
    }
    const outcome = answerOutcome(answer, rule);
    if (rule.kind === "noul") {
      const result: ProposalCheck["result"] =
        outcome.option === "unknown" || outcome.option === null
          ? "unknown"
          : (outcome.option === "yes") === (rule.yes_is === "pass")
          ? "pass"
          : "fail";
      if (rule.label) {
        checks.push({ code: `jev_${id}`, label: rule.label, result, detail: `Jev probability of yes: ${round2(outcome.p)}`, source: "jev" });
      }
      if (result === "fail" && rule.note_on_fail) warnings.push({ code: `jev_${id}`, message: rule.note_on_fail });
      continue;
    }
    // choice
    const question = questions[id];
    const optionText = outcome.option && question?.type === "choice" ? String(question.criteria[outcome.option] ?? outcome.option) : null;
    if (rule.label) {
      const result: ProposalCheck["result"] =
        outcome.option === null
          ? "unknown"
          : rule.pass?.includes(outcome.option)
          ? "pass"
          : rule.fail?.includes(outcome.option)
          ? "fail"
          : "unknown";
      const detail = optionText ? `Jev: ${optionText.slice(0, 120)} (${round2(outcome.p)})` : `Jev was not sure (${round2(outcome.p)})`;
      checks.push({ code: `jev_${id}`, label: rule.label, result, detail, source: "jev" });
    }
    if (outcome.option && rule.notes?.[outcome.option]) {
      warnings.push({ code: `jev_${id}_${outcome.option}`, message: rule.notes[outcome.option] });
    }
  }
  return { checks, warnings };
}

// ── Code checks ─────────────────────────────────────────────────────────────

function check(code: string, label: string, result: ProposalCheck["result"], detail: string): ProposalCheck {
  return { code, label, result, detail, source: "code" };
}

function datedObligation(
  code: string,
  label: string,
  due: string | null,
  today: string,
  what: string,
  warnings: Warning[],
): ProposalCheck | null {
  if (!due) return null;
  const left = daysBetween(today, due);
  if (left < 0) return check(code, label, "fail", `${what} ${due} passed ${-left} days ago`);
  if (left <= SOON_DAYS) warnings.push({ code: `${code}_soon`, message: `${what} in ${left} days (${due}).` });
  return check(code, label, "pass", `${what} ${due}, ${left} days from today`);
}

/** "$1,000,000" -> 100000000 cents; null when no single amount is readable. */
export function parseUsdCents(text: string | null): number | null {
  if (!text) return null;
  const m = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]{2}))?/.exec(text);
  if (!m) return null;
  const dollars = Number(m[1].replace(/,/g, ""));
  const cents = m[2] ? Number(m[2]) : 0;
  return Number.isFinite(dollars) ? dollars * 100 + cents : null;
}

/**
 * Haven stores AHCA license numbers as bare digits ("12528"); certificates may
 * print a prefix or leading zeros ("AL 012528"). When the value on file is all
 * digits, compare digits only.
 */
export function sameLicenseNumber(onFile: string, shown: string): boolean {
  const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  return /^\d+$/.test(onFile.trim()) ? digits(onFile) !== "" && digits(onFile) === digits(shown) : alnum(onFile) === alnum(shown);
}

/** Per-type code checks. Runs after Jev so it can use Jev's classifications. */
export function typeCodeChecks(code: string, e: Evidence, ctx: CheckContext): { checks: ProposalCheck[]; warnings: Warning[] } {
  const checks: ProposalCheck[] = [];
  const warnings: Warning[] = [];
  const push = (c: ProposalCheck | null) => {
    if (c) checks.push(c);
  };
  const rules = answerRules(code);
  const winning = (id: string) => answerOutcome(ctx.answers[id], rules[id]).option;

  // Common: the page marker against the stored file.
  const stated = int(e, "stated_total_pages");
  if (stated !== null && ctx.pageCount !== null) {
    push(check("page_marker_complete", "All stated pages present", ctx.pageCount >= stated ? "pass" : "fail", `Document says ${stated} pages; file has ${ctx.pageCount}`));
  }

  // Common: date of birth against the proposed resident.
  const dob = str(e, "date_of_birth") ?? ctx.readerDob;
  if (dob && ctx.resident?.date_of_birth) {
    const same = ctx.resident.date_of_birth.slice(0, 10) === dob;
    push(check("dob_matches", "Date of birth matches the resident", same ? "pass" : "fail", same ? "Matches Haven" : "Differs from the date of birth in Haven"));
  }

  switch (code) {
    case "form_1823": {
      const exam = str(e, "exam_date");
      const label = "Exam date in the admission window or the last 365 days";
      if (!exam) {
        push(check("form_1823_exam_timing", label, "unknown", "No exam date found"));
      } else if (exam > ctx.today) {
        push(check("form_1823_exam_timing", label, "fail", `Exam date ${exam} is in the future`));
      } else if (!ctx.resident) {
        push(check("form_1823_exam_timing", label, "unknown", "No resident proposed; compare the exam date to the admission date by hand"));
      } else if (!ctx.resident.admission_date) {
        push(check("form_1823_exam_timing", label, "unknown", "No admission date on file for this resident"));
      } else {
        const adm = ctx.resident.admission_date.slice(0, 10);
        const lo = addDays(adm, -MEDICAL_EXAM_PRIOR_DAYS);
        const hi = addDays(adm, MEDICAL_EXAM_POST_DAYS);
        if (exam >= lo && exam <= hi) {
          push(check("form_1823_exam_timing", label, "pass", `Admission exam: ${exam} is within ${MEDICAL_EXAM_PRIOR_DAYS} days before or ${MEDICAL_EXAM_POST_DAYS} days after admission ${adm}`));
        } else if (exam < lo) {
          push(check("form_1823_exam_timing", label, "fail", `Exam ${exam} is more than ${MEDICAL_EXAM_PRIOR_DAYS} days before admission ${adm}`));
        } else {
          const age = daysBetween(exam, ctx.today);
          push(
            check(
              "form_1823_exam_timing",
              label,
              age <= FORM_1823_DEFAULT_VALID_DAYS ? "pass" : "fail",
              `Renewal exam, ${age} days old; facility default is ${FORM_1823_DEFAULT_VALID_DAYS} days (BH-6)`,
            ),
          );
        }
      }
      const signed = str(e, "examiner_signature_date");
      if (signed && exam) {
        const ok = signed >= exam && signed <= ctx.today;
        push(check("form_1823_signature_date", "Signed on or after the exam date", ok ? "pass" : "fail", `Exam ${exam}; signed ${signed}`));
      } else {
        push(check("form_1823_signature_date", "Signed on or after the exam date", "unknown", "Exam or signature date not found"));
      }
      break;
    }

    case "face_sheet": {
      const adm = str(e, "admission_date");
      if (adm && ctx.resident?.admission_date) {
        const same = ctx.resident.admission_date.slice(0, 10) === adm;
        push(check("admission_date_matches", "Admission date matches Haven", same ? "pass" : "fail", same ? "Matches Haven" : `Face sheet ${adm}; Haven ${ctx.resident.admission_date.slice(0, 10)}`));
      }
      break;
    }

    case "tb_screening":
    case "staff_medical": {
      if (winning("test_kind") === "tst") {
        const placed = str(e, "administered_date");
        const read = str(e, "read_date");
        if (placed && read) {
          const gap = daysBetween(placed, read);
          const ok = gap >= TST_READ_MIN_DAYS && gap <= TST_READ_MAX_DAYS;
          push(check("tst_read_window", "Skin test read 48 to 72 hours after placement", ok ? "pass" : "fail", `Placed ${placed}; read ${read} (${gap} days)`));
        } else {
          push(check("tst_read_window", "Skin test read 48 to 72 hours after placement", "unknown", "Placement or reading date not found"));
        }
      }
      break;
    }

    case "medicaid_letter": {
      const printed = str(e, "deadline_date");
      const days = int(e, "deadline_days");
      const notice = str(e, "notice_date");
      let due = printed;
      let basis = "printed date";
      if (!due && days !== null && notice && winning("deadline_from_notice_date") === "yes") {
        due = addDays(notice, days);
        basis = `${days} days from the notice date ${notice}`;
      }
      const statedDeadline = winning("deadline_stated") === "yes" || printed !== null || days !== null;
      if (due) {
        const left = daysBetween(ctx.today, due);
        push(
          check(
            "medicaid_response_deadline",
            "Response deadline not passed",
            left < 0 ? "fail" : "pass",
            left < 0 ? `Deadline ${due} passed ${-left} days ago (${basis})` : `Respond by ${due}, ${left} days from today (${basis})`,
          ),
        );
        if (left >= 0 && left <= SOON_DAYS) warnings.push({ code: "medicaid_deadline_soon", message: `Medicaid response due in ${left} days (${due}).` });
      } else if (statedDeadline) {
        push(check("medicaid_response_deadline", "Response deadline not passed", "unknown", "A deadline is stated but no date could be computed. Read it on the letter."));
      }
      break;
    }

    case "staff_certification": {
      const issued = str(e, "issue_date");
      if (issued && issued > ctx.today) push(check("issue_date_not_future", "Issue date not in the future", "fail", `Issued ${issued}`));
      if (issued && ctx.expirationDate) {
        push(check("expires_after_issue", "Expires after it was issued", ctx.expirationDate > issued ? "pass" : "fail", `Issued ${issued}; expires ${ctx.expirationDate}`));
      }
      break;
    }

    case "staff_training": {
      const held = str(e, "training_date");
      if (held && held > ctx.today) push(check("training_date_not_future", "Training date not in the future", "fail", `Training ${held}`));
      const attendees = int(e, "attendee_count");
      if (attendees !== null && attendees > 1) warnings.push({ code: "sign_in_sheet_count", message: `This record lists ${attendees} people.` });
      break;
    }

    case "facility_license": {
      const effective = str(e, "effective_date");
      const expires = ctx.expirationDate;
      if (effective && expires) {
        if (effective > ctx.today) {
          push(check("license_current_term", "Current license term", "unknown", `Next term: starts ${effective}. Keep the current license on file until then.`));
        } else {
          push(check("license_current_term", "Current license term", expires >= ctx.today ? "pass" : "fail", `Term ${effective} to ${expires}; today ${ctx.today}`));
        }
      }
      if (winning("license_kind") === "ahca_alf_license") {
        const onFile = ctx.facility?.ahca_license_number ?? null;
        const shown = str(e, "license_number");
        if (onFile && shown) {
          const same = sameLicenseNumber(onFile, shown);
          push(check("license_number_matches", "License number matches Haven", same ? "pass" : "fail", `Document ${shown}; Haven ${onFile}`));
        }
        const capacity = int(e, "licensed_capacity");
        const beds = ctx.facility?.licensed_beds ?? null;
        if (capacity !== null && beds !== null) {
          push(check("licensed_capacity_matches", "Licensed capacity matches Haven", capacity === beds ? "pass" : "fail", `Document ${capacity} beds; Haven ${beds}`));
        }
        const onFileExp = ctx.facility?.ahca_license_expiration ?? null;
        if (expires && onFileExp && expires > onFileExp) {
          warnings.push({ code: "license_newer_than_on_file", message: `Newer than the license on file (on file expires ${onFileExp}). Update the facility record after filing.` });
        }
      }
      break;
    }

    case "facility_inspection":
    case "facility_fire":
      push(datedObligation("correction_due", "Correction date not passed", str(e, "correction_due_date"), ctx.today, "Corrections due", warnings));
      break;

    case "facility_generator":
    case "facility_pest":
      push(datedObligation("next_service_due", "Next service not overdue", str(e, "next_service_date"), ctx.today, "Next service due", warnings));
      break;

    case "facility_survey": {
      const tags = list(e, "tags_cited");
      const poc = datedObligation("poc_due", "Plan of correction not overdue", str(e, "poc_due_date"), ctx.today, "Plan of correction due", warnings);
      if (poc) poc.detail = `${poc.detail}; ${tags.length} tag${tags.length === 1 ? "" : "s"} cited`;
      push(poc);
      push(datedObligation("survey_correction_due", "Correction date not passed", str(e, "correction_date"), ctx.today, "Corrections due", warnings));
      break;
    }

    case "facility_insurance": {
      const start = str(e, "policy_start");
      const end = str(e, "policy_end");
      if (start && end) {
        if (start > ctx.today) push(check("policy_current_term", "Current policy term", "unknown", `Next term: starts ${start}`));
        else push(check("policy_current_term", "Current policy term", end >= ctx.today ? "pass" : "fail", `Term ${start} to ${end}; today ${ctx.today}`));
      }
      break;
    }

    case "vendor_coi": {
      const ends: [string, string | null][] = [
        ["General liability", str(e, "gl_policy_end")],
        ["Workers compensation", str(e, "wc_policy_end")],
        ["Auto liability", str(e, "auto_policy_end")],
      ];
      const present = ends.filter((x): x is [string, string] => x[1] !== null);
      if (present.length === 0) {
        push(check("coi_coverage_current", "Coverage in force", "unknown", "No policy expiration dates found"));
      } else {
        const lapsed = present.filter(([, d]) => d < ctx.today);
        const earliest = present.map(([, d]) => d).sort()[0];
        push(
          check(
            "coi_coverage_current",
            "Coverage in force",
            lapsed.length ? "fail" : "pass",
            lapsed.length ? `Expired: ${lapsed.map(([n, d]) => `${n} ${d}`).join(", ")}` : `Earliest expiration ${earliest}`,
          ),
        );
        if (!lapsed.length && daysBetween(ctx.today, earliest) <= SOON_DAYS) {
          warnings.push({ code: "coi_expiring_soon", message: `A vendor policy expires ${earliest}. Request the renewal certificate.` });
        }
      }
      if (VENDOR_COI_MIN_GL_EACH_OCCURRENCE_CENTS !== null) {
        const cents = parseUsdCents(str(e, "gl_each_occurrence_excerpt"));
        push(
          cents === null
            ? check("coi_gl_minimum", "General liability meets the minimum", "unknown", "Each-occurrence limit not readable")
            : check("coi_gl_minimum", "General liability meets the minimum", cents >= VENDOR_COI_MIN_GL_EACH_OCCURRENCE_CENTS ? "pass" : "fail", `Each occurrence $${(cents / 100).toLocaleString("en-US")}`),
        );
      }
      break;
    }

    case "vendor_contract": {
      const termEnd = str(e, "term_end_date");
      const notice = int(e, "termination_notice_days");
      if (termEnd && notice !== null) {
        push(datedObligation("contract_cancel_by", "Cancel-by date not passed", addDays(termEnd, -notice), ctx.today, "Cancel by", warnings));
      }
      break;
    }
  }
  return { checks, warnings };
}
