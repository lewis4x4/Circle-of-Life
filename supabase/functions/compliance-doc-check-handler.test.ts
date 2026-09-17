import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { triageDocument } from "./compliance-doc-check/handler.ts";
import { TypeSafeError, type SystemOneResponse } from "./_shared/typesafe-client.ts";
import { categoryMayBeSent, QUESTIONS_VERSION } from "./_shared/compliance-doc-questions.ts";

/**
 * Answers a fully compliant, issued ACORD 28 for Rising Oaks would produce.
 * Each test overrides only the judgment it is about, so a failure names the
 * judgment that changed the route rather than a whole fixture.
 */
function answers(overrides: Record<string, unknown> = {}): SystemOneResponse {
  const base: Record<string, unknown> = {
    doc_type: {
      type: "choice",
      choice: "evidence_of_property_insurance",
      probabilities: { evidence_of_property_insurance: 0.93, mortgagee_endorsement: 0.07 },
      confidence: 0.91,
    },
    facility_named: {
      type: "choice",
      choice: "rising_oaks",
      probabilities: { rising_oaks: 0.95, unknown: 0.05 },
      confidence: 0.94,
    },
    names_berkadia: { type: "noul", noul: 0.96 },
    names_hud_secretary: { type: "noul", noul: 0.93 },
    isaoa_atima_present: { type: "noul", noul: 0.89 },
    epi_period: {
      type: "choice",
      choice: "at_least_180",
      probabilities: { at_least_180: 0.9, not_stated: 0.1 },
      confidence: 0.88,
    },
    is_draft: { type: "noul", noul: 0.04 },
    carrier_and_policy_identified: { type: "noul", noul: 0.97 },
    readiness: {
      type: "score",
      score: 2.9,
      probabilities: { "0": 0.01, "1": 0.02, "2": 0.07, "3": 0.9 },
      confidence: 0.9,
    },
  };
  return {
    model: "jev-latest",
    answers: { ...base, ...overrides } as SystemOneResponse["answers"],
    usage: { input_tokens: 4200, output_tokens: 120 },
  };
}

const RISING_OAKS = "Rising Oaks ALF";

Deno.test("issued, compliant, correctly filed document is send-ready", () => {
  const triage = triageDocument(answers(), RISING_OAKS);
  assertEquals(triage.route, "send_ready");
  assertEquals(triage.flags, []);
  assertEquals(triage.uncertainties, []);
  assertEquals(triage.facility_matches, true);
  assertEquals(triage.questions_version, QUESTIONS_VERSION);
});

Deno.test("generic mortgagee wording is caught on evidence of property insurance, not only on endorsements", () => {
  // The document does not call itself an endorsement. Gating the wording check
  // on the document kind would skip exactly the case this function exists for.
  const triage = triageDocument(
    answers({
      names_berkadia: { type: "noul", noul: 0.08 },
      names_hud_secretary: { type: "noul", noul: 0.05 },
      isaoa_atima_present: { type: "noul", noul: 0.11 },
      readiness: { type: "score", score: 0.6, probabilities: {}, confidence: 0.8 },
    }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "blocked");
  assertEquals(triage.flags, [
    "HUD_232_BERKADIA_MISSING",
    "HUD_232_HUD_SECRETARY_MISSING",
    "HUD_232_ISAOA_ATIMA_MISSING",
  ]);
});

Deno.test("a missing HUD party is named on its own", () => {
  const triage = triageDocument(
    answers({ names_hud_secretary: { type: "noul", noul: 0.06 } }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "blocked");
  assertEquals(triage.flags, ["HUD_232_HUD_SECRETARY_MISSING"]);
});

Deno.test("mortgagee wording in the uncertain band goes to a person, not back to the agent", () => {
  const triage = triageDocument(
    answers({ names_hud_secretary: { type: "noul", noul: 0.5 } }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "human_review");
  assertEquals(triage.flags, []);
  assertEquals(triage.uncertainties, ["MORTGAGEE_WORDING_UNCERTAIN"]);
});

Deno.test("a stated EPI shorter than 180 days blocks", () => {
  const triage = triageDocument(
    answers({
      doc_type: {
        type: "choice",
        choice: "epi_endorsement",
        probabilities: { epi_endorsement: 0.95 },
        confidence: 0.94,
      },
      epi_period: {
        type: "choice",
        choice: "under_180",
        probabilities: { under_180: 0.92 },
        confidence: 0.91,
      },
    }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "blocked");
  assertEquals(triage.flags, ["EPI_UNDER_180_DAYS"]);
});

Deno.test("an EPI endorsement that states no period blocks; other documents are not held to it", () => {
  const unstatedOnEndorsement = triageDocument(
    answers({
      doc_type: {
        type: "choice",
        choice: "epi_endorsement",
        probabilities: { epi_endorsement: 0.95 },
        confidence: 0.94,
      },
      epi_period: {
        type: "choice",
        choice: "not_stated",
        probabilities: { not_stated: 0.85 },
        confidence: 0.84,
      },
    }),
    RISING_OAKS,
  );
  assertEquals(unstatedOnEndorsement.flags, ["EPI_PERIOD_NOT_STATED"]);

  const unstatedOnLiability = triageDocument(
    answers({
      doc_type: {
        type: "choice",
        choice: "liability_certificate",
        probabilities: { liability_certificate: 0.96 },
        confidence: 0.95,
      },
      epi_period: {
        type: "choice",
        choice: "not_stated",
        probabilities: { not_stated: 0.8 },
        confidence: 0.79,
      },
    }),
    RISING_OAKS,
  );
  assertEquals(unstatedOnLiability.flags, []);
});

Deno.test("a liability certificate is not held to HUD 232 mortgagee wording", () => {
  const triage = triageDocument(
    answers({
      doc_type: {
        type: "choice",
        choice: "liability_certificate",
        probabilities: { liability_certificate: 0.96 },
        confidence: 0.95,
      },
      names_berkadia: { type: "noul", noul: 0.02 },
      names_hud_secretary: { type: "noul", noul: 0.02 },
      isaoa_atima_present: { type: "noul", noul: 0.02 },
      epi_period: {
        type: "choice",
        choice: "not_applicable",
        probabilities: { not_applicable: 0.97 },
        confidence: 0.96,
      },
    }),
    RISING_OAKS,
  );
  assertEquals(triage.flags, []);
  assertEquals(triage.route, "send_ready");
});

Deno.test("an unsettled document kind is still checked for mortgagee wording", () => {
  const triage = triageDocument(
    answers({
      doc_type: {
        type: "choice",
        choice: "other",
        probabilities: { other: 0.34, evidence_of_property_insurance: 0.33 },
        confidence: 0.35,
      },
      names_berkadia: { type: "noul", noul: 0.04 },
    }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "blocked");
  assertEquals(triage.flags, ["HUD_232_BERKADIA_MISSING"]);
  assertEquals(triage.uncertainties, ["DOC_TYPE_UNCERTAIN"]);
});

Deno.test("a draft blocks even when the wording is right", () => {
  const triage = triageDocument(
    answers({
      is_draft: { type: "noul", noul: 0.88 },
      readiness: { type: "score", score: 2.1, probabilities: {}, confidence: 0.8 },
    }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "blocked");
  assertEquals(triage.flags, ["DRAFT_NOT_ISSUED"]);
});

Deno.test("an unresolved carrier blocks — the Grande Cypress case", () => {
  const triage = triageDocument(
    answers({
      facility_named: {
        type: "choice",
        choice: "grande_cypress",
        probabilities: { grande_cypress: 0.93 },
        confidence: 0.92,
      },
      carrier_and_policy_identified: { type: "noul", noul: 0.12 },
    }),
    "Grande Cypress ALF",
  );
  assertEquals(triage.route, "blocked");
  assertEquals(triage.flags, ["CARRIER_UNRESOLVED"]);
});

Deno.test("a document naming another facility is a filing question, not an agent's defect", () => {
  const triage = triageDocument(answers(), "Oakridge ALF");
  assertEquals(triage.route, "human_review");
  assertEquals(triage.flags, ["FACILITY_MISMATCH"]);
  assertEquals(triage.facility_matches, false);
});

Deno.test("a schedule covering several facilities satisfies the cross-check", () => {
  const triage = triageDocument(
    answers({
      facility_named: {
        type: "choice",
        choice: "multiple",
        probabilities: { multiple: 0.88 },
        confidence: 0.87,
      },
    }),
    RISING_OAKS,
  );
  assertEquals(triage.facility_matches, true);
  assertEquals(triage.route, "send_ready");
});

Deno.test("a facility the question set cannot name is surfaced, not silently unmatched", () => {
  // A sixth building would otherwise read as `unknown` forever, because the
  // question's criteria are hardcoded.
  const triage = triageDocument(answers(), "Sunrise Villa ALF");
  assertEquals(triage.route, "human_review");
  assertEquals(triage.uncertainties, ["FACILITY_NOT_IN_QUESTION_SET"]);
  assertEquals(triage.facility_matches, null);
});

Deno.test("an unidentifiable facility routes to review", () => {
  const triage = triageDocument(
    answers({
      facility_named: {
        type: "choice",
        choice: "unknown",
        probabilities: { unknown: 0.6 },
        confidence: 0.58,
      },
    }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "human_review");
  assertEquals(triage.uncertainties, ["FACILITY_UNRESOLVED"]);
  assertEquals(triage.facility_matches, null);
});

Deno.test("compliant wording awaiting issuance waits on the carrier", () => {
  const triage = triageDocument(
    answers({ readiness: { type: "score", score: 2.1, probabilities: {}, confidence: 0.8 } }),
    RISING_OAKS,
  );
  assertEquals(triage.route, "pending_carrier");
  assertEquals(triage.flags, []);
});

Deno.test("a calibration run with no vault row skips the facility cross-check", () => {
  const triage = triageDocument(answers(), null);
  assertEquals(triage.facility_matches, null);
  assertEquals(triage.uncertainties, []);
  assertEquals(triage.route, "send_ready");
});

Deno.test("a missing answer fails loudly rather than defaulting", () => {
  const incomplete = answers();
  delete (incomplete.answers as Record<string, unknown>).names_berkadia;
  assertThrows(() => triageDocument(incomplete, RISING_OAKS), TypeSafeError);
});

Deno.test("a loss run or resident contract is withheld from the model entirely", () => {
  // Category refusal, not a sniff over the text: a loss run carries claim-level
  // detail that can name a resident, and the gate is the subprocessor's BAA.
  assertEquals(categoryMayBeSent("insurance_loss_run"), false);
  assertEquals(categoryMayBeSent("resident_contracts_master"), false);
  assertEquals(categoryMayBeSent("insurance_property"), true);
  assertEquals(categoryMayBeSent("insurance_certificate"), true);
  // A calibration run has no vault row and therefore no category to refuse on.
  assertEquals(categoryMayBeSent(null), true);
});
