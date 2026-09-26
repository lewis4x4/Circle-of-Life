// Question sets and code checks (spec Appendix E1), ported to Deno.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  answerRules,
  buildIntakeQuestions,
  INTAKE_TYPE_QUESTIONS,
  parseEvidence,
  questionsVersion,
  readerEvidencePrompt,
} from "./intake-type-questions.ts";
import { type CheckContext, jevChecks, typeCodeChecks } from "./intake-type-checks.ts";

// Production catalog codes (document_intake_catalog, 2026-09-26), minus payment_evidence.
const CODES = [
  "form_1823", "face_sheet", "physician_orders", "advance_directive", "authority_instrument", "insurance_card", "photo_id",
  "admission_agreement", "financial_agreement", "tb_screening", "resident_consent", "resident_other", "medicaid_letter",
  "medicaid_application_doc", "staff_certification", "staff_training", "staff_personnel", "staff_medical", "facility_license",
  "facility_inspection", "facility_fire", "facility_generator", "facility_pest", "facility_survey", "facility_insurance",
  "vendor_coi", "vendor_contract", "facility_other", "unknown",
];

Deno.test("every catalog code has a set and every rule is well formed", () => {
  for (const code of CODES) {
    assert(INTAKE_TYPE_QUESTIONS[code], `missing set ${code}`);
    const qs = buildIntakeQuestions({ code, label: code, candidates: ["A", "B"] });
    const rules = answerRules(code);
    for (const [id, rule] of Object.entries(rules)) {
      const q = qs[id];
      assert(q, `${code}: rule ${id} has no question`);
      if (rule.kind === "choice") {
        assertEquals(q.type, "choice", `${code}.${id} rule/question kind`);
        const opts = Object.keys((q as { criteria: Record<string, unknown> }).criteria);
        for (const o of [...(rule.pass ?? []), ...(rule.fail ?? []), ...Object.keys(rule.notes ?? {})]) {
          assert(opts.includes(o), `${code}.${id} option ${o}`);
        }
      } else {
        assertEquals(q.type, "noul", `${code}.${id} rule/question kind`);
      }
      if (rule.when) {
        assert(qs[rule.when.question], `${code}.${id} when -> ${rule.when.question}`);
        const gate = qs[rule.when.question];
        if (gate.type === "choice") {
          for (const o of rule.when.in) assert(Object.keys(gate.criteria).includes(o), `${code}.${id} when option ${o}`);
        }
      }
    }
    for (const id of Object.keys(qs)) if (id !== "destination") assert(rules[id], `${code}: question ${id} has no rule`);
    assertMatch(questionsVersion(code), /^intake-v2\/[a-z0-9_]+\.\d+$/);
  }
});

for (const code of CODES) {
  Deno.test(`${code}: questions and rules pair up`, () => {
    const qs = buildIntakeQuestions({ code, label: code, candidates: ["A", "B"] });
    const rules = answerRules(code);
    for (const id of Object.keys(qs)) {
      if (id === "destination") continue;
      assert(rules[id], `${code}: question ${id} has no rule`);
    }
    for (const id of Object.keys(rules)) assert(qs[id], `${code}: rule ${id} has no question`);
  });
}

Deno.test("reader evidence prompt stays compact", () => {
  const prompt = readerEvidencePrompt(CODES);
  assert(prompt.length < 24000, `evidence prompt is ${prompt.length} chars`);
  assert(!prompt.includes("\u2014"), "no em dash in prompt");
});

Deno.test("parseEvidence keeps typed fields only and masks", () => {
  const mask = (s: string) => s.replace(/\b\d{9,17}\b/g, (m) => `****${m.slice(-4)}`);
  const { evidence, notes } = parseEvidence("form_1823", {
    exam_date: "2026-09-10",
    examiner_signature_date: "2026-02-30",
    examiner_line: "Jane Doe APRN lic 123456789",
    blank_sections: ["Section 3"],
    extra: "x",
    stated_total_pages: 4,
  }, mask);
  assertEquals(evidence.exam_date, "2026-09-10");
  assertEquals(evidence.examiner_signature_date, null);
  assert(notes.includes("evidence_invalid:examiner_signature_date"));
  assertEquals(evidence.examiner_line, "Jane Doe APRN lic ****6789");
  assertEquals(evidence.blank_sections, ["Section 3"]);
  assertEquals(evidence.stated_total_pages, 4);
  assert(!("extra" in evidence));
});

const base = (over: Partial<CheckContext> = {}): CheckContext => ({
  today: "2026-10-05",
  pageCount: 4,
  expirationDate: null,
  readerDob: null,
  resident: null,
  facility: null,
  answers: {},
  ...over,
});

Deno.test("form 1823 admission window and renewal", () => {
  const find = (r: ReturnType<typeof typeCodeChecks>) => r.checks.find((c) => c.code === "form_1823_exam_timing")!;
  const res = { date_of_birth: "1940-01-01", admission_date: "2026-10-01" };
  assertEquals(find(typeCodeChecks("form_1823", { exam_date: "2026-08-15" }, base({ resident: res }))).result, "pass");
  assertEquals(find(typeCodeChecks("form_1823", { exam_date: "2026-07-01" }, base({ resident: res }))).result, "fail");
  const old = { date_of_birth: null, admission_date: "2024-01-10" };
  assertEquals(find(typeCodeChecks("form_1823", { exam_date: "2026-03-01" }, base({ resident: old }))).result, "pass");
  assertEquals(find(typeCodeChecks("form_1823", { exam_date: "2025-09-01" }, base({ resident: old }))).result, "fail");
  assertEquals(find(typeCodeChecks("form_1823", { exam_date: "2026-08-15" }, base())).result, "unknown");
  const sig = typeCodeChecks(
    "form_1823",
    { exam_date: "2026-08-15", examiner_signature_date: "2026-08-14" },
    base({ resident: res }),
  ).checks.find((c) => c.code === "form_1823_signature_date")!;
  assertEquals(sig.result, "fail");
});

Deno.test("page marker and dob", () => {
  const r = typeCodeChecks("admission_agreement", { stated_total_pages: 14 }, base({ pageCount: 12 }));
  assertEquals(r.checks.find((c) => c.code === "page_marker_complete")!.result, "fail");
  const d = typeCodeChecks(
    "photo_id",
    { date_of_birth: "1941-02-03" },
    base({ resident: { date_of_birth: "1941-02-04", admission_date: null } }),
  );
  assertEquals(d.checks.find((c) => c.code === "dob_matches")!.result, "fail");
});

Deno.test("medicaid deadline from notice date, only when Jev says it runs from the notice", () => {
  const ev = { notice_date: "2026-09-28", deadline_days: 10 };
  const yes = {
    deadline_stated: { type: "noul" as const, noul: 0.93 },
    deadline_from_notice_date: { type: "noul" as const, noul: 0.88 },
  };
  const r = typeCodeChecks("medicaid_letter", ev, base({ answers: yes }));
  const c = r.checks.find((x) => x.code === "medicaid_response_deadline")!;
  assertEquals(c.result, "pass");
  assertMatch(c.detail!, /2026-10-08/);
  assert(r.warnings.some((w) => w.code === "medicaid_deadline_soon"));
  const unsure = {
    deadline_stated: { type: "noul" as const, noul: 0.93 },
    deadline_from_notice_date: { type: "noul" as const, noul: 0.5 },
  };
  assertEquals(
    typeCodeChecks("medicaid_letter", ev, base({ answers: unsure })).checks.find((x) =>
      x.code === "medicaid_response_deadline"
    )!.result,
    "unknown",
  );
  const past = typeCodeChecks("medicaid_letter", { deadline_date: "2026-10-01" }, base());
  assertEquals(past.checks[0].result, "fail");
});

Deno.test("jev choice rule, notes and when-gates", () => {
  const answers = {
    examiner_credential: {
      type: "choice" as const,
      choice: "nurse_or_other",
      probabilities: { nurse_or_other: 0.81, aprn: 0.1, md_do: 0.05, pa: 0.02, none: 0.02 },
    },
    examiner_signed: { type: "noul" as const, noul: 0.2 },
    alf_needs_met: { type: "choice" as const, choice: "no", probabilities: { no: 0.9, yes: 0.05, not_answered: 0.05 } },
    communicable_disease: {
      type: "choice" as const,
      choice: "free",
      probabilities: { free: 0.5, not_free: 0.3, not_answered: 0.2 },
    },
  };
  const { checks, warnings } = jevChecks("form_1823", "AHCA Form 1823", answers);
  const by = Object.fromEntries(checks.map((c) => [c.code, c.result]));
  assertEquals(by.jev_examiner_credential, "fail");
  assertEquals(by.jev_examiner_signed, "fail");
  assertEquals(by.jev_alf_needs_met, "fail");
  assertEquals(by.jev_communicable_disease, "unknown");
  assert(warnings.some((w) => w.code === "jev_examiner_signed"));
  assert(warnings.some((w) => w.code === "jev_alf_needs_met_no"));
  // DNRO physician signature only asked of a DNRO.
  const living = jevChecks("advance_directive", "Advance directive", {
    directive_kind: { type: "choice", choice: "living_will", probabilities: { living_will: 0.9 } },
    physician_signed: { type: "noul", noul: 0.1 },
  });
  assert(!living.checks.some((c) => c.code === "jev_physician_signed"));
  const dnro = jevChecks("advance_directive", "Advance directive", {
    directive_kind: { type: "choice", choice: "dnro", probabilities: { dnro: 0.9 } },
    physician_signed: { type: "noul", noul: 0.1 },
  });
  assertEquals(dnro.checks.find((c) => c.code === "jev_physician_signed")!.result, "fail");
  // Inverted noul: pest activity yes -> fail.
  const pest = jevChecks("facility_pest", "Pest control record", { activity_found: { type: "noul", noul: 0.9 } });
  assertEquals(pest.checks[0].result, "fail");
});

Deno.test("facility license: number, capacity, term, newer than on file", () => {
  const answers = {
    license_kind: { type: "choice" as const, choice: "ahca_alf_license", probabilities: { ahca_alf_license: 0.95 } },
  };
  const r = typeCodeChecks(
    "facility_license",
    { license_number: "AL 012528", effective_date: "2026-09-28", licensed_capacity: 36 },
    base({
      answers,
      expirationDate: "2028-09-27",
      facility: { ahca_license_number: "12528", ahca_license_expiration: "2026-09-27", licensed_beds: 36 },
    }),
  );
  const by = Object.fromEntries(r.checks.map((c) => [c.code, c.result]));
  assertEquals(by.license_number_matches, "pass");
  const wrong = typeCodeChecks(
    "facility_license",
    { license_number: "9863" },
    base({ answers, facility: { ahca_license_number: "12528", ahca_license_expiration: null, licensed_beds: 36 } }),
  );
  assertEquals(wrong.checks.find((c) => c.code === "license_number_matches")!.result, "fail");
  assertEquals(by.licensed_capacity_matches, "pass");
  assertEquals(by.license_current_term, "pass");
  assert(r.warnings.some((w) => w.code === "license_newer_than_on_file"));
});

Deno.test("vendor coi coverage and contract cancel-by", () => {
  const coi = typeCodeChecks("vendor_coi", { gl_policy_end: "2026-10-12", wc_policy_end: "2026-09-30" }, base());
  assertEquals(coi.checks.find((c) => c.code === "coi_coverage_current")!.result, "fail");
  const k = typeCodeChecks("vendor_contract", { term_end_date: "2026-12-31", termination_notice_days: 60 }, base());
  const c = k.checks.find((x) => x.code === "contract_cancel_by")!;
  assertEquals(c.result, "pass");
  assertMatch(c.detail!, /2026-11-01/);
});

Deno.test("tst read window uses Jev's test kind", () => {
  const tst = { test_kind: { type: "choice" as const, choice: "tst", probabilities: { tst: 0.9 } } };
  const r = typeCodeChecks(
    "tb_screening",
    { administered_date: "2026-09-01", read_date: "2026-09-05" },
    base({ answers: tst }),
  );
  assertEquals(r.checks.find((c) => c.code === "tst_read_window")!.result, "fail");
  const igra = { test_kind: { type: "choice" as const, choice: "igra", probabilities: { igra: 0.9 } } };
  assert(
    !typeCodeChecks("tb_screening", { administered_date: "2026-09-01" }, base({ answers: igra })).checks.some((c) =>
      c.code === "tst_read_window"
    ),
  );
});
