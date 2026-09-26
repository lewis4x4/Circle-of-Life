/**
 * intake-type-questions: Jev's per-type question sets for Document Intake
 * (COL-771, DI-09).
 *
 * Division of labor, per DOCUMENT-INTAKE-DECISION.md "AI roles":
 *   - The reader (Claude) sees the original and copies EVIDENCE: short verbatim
 *     excerpts, dates and whole numbers listed per type below. Where a field
 *     says "describe", the reader describes what it sees in one sentence
 *     (signature marks cannot be copied as text).
 *   - Jev never sees the original. It answers JUDGMENT questions about that
 *     evidence: who signed, what kind of letter, which facility is named.
 *   - Code does every date, amount, count and identity comparison
 *     (intake-type-checks.ts). No question here asks Jev whether something is
 *     expired, late, adequate or correctly priced.
 *
 * Every question and every answer rule lives here and nowhere else. When any
 * wording or rule for a type changes, bump that type's `version`. When shared
 * wording or the builder changes, bump INTAKE_QUESTIONS_VERSION. The recorded
 * `questions_version` is `intake-v2/<code>.<version>`, so the accuracy report
 * never mixes answers given to different wording.
 *
 * PHI: a type whose catalog row has contains_phi = true reaches Jev only when
 * routing_json.document_intake.jev_phi_enabled is true, which stays false
 * until COL-466 (TypeSafe BAA) closes. The evidence lists are deliberately
 * minimal: only what the questions need, never diagnoses or medications.
 */

import type { SystemOneQuestion } from "./typesafe-client.ts";

/** Bump when shared wording, the builder, or the answer interpretation changes. */
export const INTAKE_QUESTIONS_VERSION = "intake-v2";

/** Noul answers inside this band are "unknown", never pass or fail. */
export const DEFAULT_NOUL_BAND = { low: 0.35, high: 0.65 } as const;

/** A choice answer whose winning probability is below this counts as unknown. */
export const DEFAULT_CHOICE_MIN_PROBABILITY = 0.6;

/** Max characters kept for any text evidence value. */
export const EVIDENCE_TEXT_MAX = 300;

/** Max items kept for any list evidence value. */
export const EVIDENCE_LIST_MAX = 20;

// ── Types ───────────────────────────────────────────────────────────────────

export type EvidenceKind = "text" | "date" | "int" | "list";

export type EvidenceField = { kind: EvidenceKind; describe: string };

export type EvidenceValue = string | number | string[] | null;

export type Evidence = Record<string, EvidenceValue>;

/** Only evaluate a rule when another question's winning option is one of `in`. */
export type RuleCondition = { question: string; in: string[] };

export type NoulRule = {
  kind: "noul";
  /**
   * The check label, phrased as the passing state ("Examiner signed").
   * Omit to record the answer without producing a check (code may still read it).
   */
  label?: string;
  /** Whether a confident yes is a pass or a fail. */
  yes_is: "pass" | "fail";
  band?: { low: number; high: number };
  when?: RuleCondition;
  /** Reviewer note (a proposal warning) when the check fails. */
  note_on_fail?: string;
};

export type ChoiceRule = {
  kind: "choice";
  /** Omit `label` to record the answer without producing a check. */
  label?: string;
  pass?: string[];
  fail?: string[];
  min_probability?: number;
  /** Winning option -> reviewer note (a proposal warning). */
  notes?: Record<string, string>;
  when?: RuleCondition;
};

export type AnswerRule = NoulRule | ChoiceRule;

export type TypeQuestionSet = {
  version: number;
  evidence: Record<string, EvidenceField>;
  questions: Record<string, SystemOneQuestion>;
  rules: Record<string, AnswerRule>;
};

// ── Shared pieces ───────────────────────────────────────────────────────────

/** Every type also gets this evidence field; code compares it to the file. */
export const COMMON_EVIDENCE: Record<string, EvidenceField> = {
  stated_total_pages: {
    kind: "int",
    describe: "The total page count the document states about itself (the N in 'Page x of N'), or null when no page marker is printed.",
  },
};

function signedBy(who: string, where: string): SystemOneQuestion {
  return {
    type: "noul",
    instructions: `Judged from the reader's description of the signature lines, ${who} signed ${where}.`,
    criteria: {
      true: `A handwritten signature, or an electronic signature statement, appears on ${who}'s line.`,
      false: `${who}'s line is blank, carries only a typed or printed name, says "signature on file", belongs to someone else, or cannot be told from the evidence.`,
    },
  };
}

function facilityMatch(what: string): SystemOneQuestion {
  return {
    type: "choice",
    instructions: `Compare ${what} in the evidence with the receiving facility and with the other Circle of Life facilities listed in the state. Which one is it?`,
    criteria: {
      this_facility: "The receiving facility, by its name, its legal entity name, its DBA, or its street address",
      sister_facility: "A different Circle of Life facility from the list, by name, legal entity or address",
      other_party: "A business, agency or person that is none of the listed facilities",
      unclear: "The evidence names none, or it cannot be told which",
    },
  };
}

const FACILITY_MATCH_RULE: ChoiceRule = {
  kind: "choice",
  label: "Names this facility",
  pass: ["this_facility"],
  fail: ["sister_facility", "other_party"],
  notes: { sister_facility: "This names a different Circle of Life building. Confirm the facility before filing." },
};

function tbTestKind(): SystemOneQuestion {
  return {
    type: "choice",
    instructions: "What kind of tuberculosis screening does the evidence describe?",
    criteria: {
      tst: "A tuberculin skin test (TST, PPD, Mantoux) with a placement and a reading",
      igra: "A blood test (IGRA, QuantiFERON, T-SPOT)",
      chest_xray: "A chest x-ray or radiology report read for tuberculosis",
      symptom_screen: "A symptom questionnaire or clinician statement without a test",
      other: "Something else, or it cannot be told",
    },
  };
}

function tbResult(): SystemOneQuestion {
  return {
    type: "choice",
    instructions: "What result does the evidence record for the tuberculosis screening?",
    criteria: {
      negative: "Negative, nonreactive, 0 mm, no evidence of active tuberculosis, or free of signs and symptoms",
      positive: "Positive, reactive, an induration the reader calls positive, or findings consistent with tuberculosis",
      indeterminate: "Indeterminate, borderline, or the test must be repeated",
      not_stated: "No result is recorded, or the result line is blank",
    },
  };
}

const TB_RESULT_RULE: ChoiceRule = {
  kind: "choice",
  label: "TB screening negative",
  pass: ["negative"],
  fail: ["positive"],
  notes: {
    positive: "Positive or abnormal TB result. Route to the Administrator before filing.",
    not_stated: "No TB result is recorded on this document.",
  },
};

const SIGNATURE_DESCRIBE = "Describe the signature line in one sentence: whose line it is, whether a handwritten or electronic signature is present, and any printed name, credential or date beside it.";

// ── The sets ────────────────────────────────────────────────────────────────

export const INTAKE_TYPE_QUESTIONS: Record<string, TypeQuestionSet> = {
  // ── Resident ──────────────────────────────────────────────────────────────

  form_1823: {
    version: 1,
    evidence: {
      exam_date: { kind: "date", describe: "The date of the medical examination as printed on the form." },
      examiner_signature_date: { kind: "date", describe: "The date written beside the examiner's signature." },
      examiner_line: { kind: "text", describe: "Copy the examiner's printed name, credential, license number and practice name exactly as written." },
      examiner_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
      alf_needs_met_excerpt: { kind: "text", describe: "Copy the examiner's answer to whether the individual's needs can be met in an assisted living facility, including which box is marked." },
      communicable_disease_excerpt: { kind: "text", describe: "Copy the examiner's answer about signs or symptoms of communicable disease, including which box is marked." },
      blank_sections: { kind: "list", describe: "Name each section or page of the form that is left entirely blank." },
    },
    questions: {
      examiner_credential: {
        type: "choice",
        instructions: "What professional credential does the examiner who completed and signed the health assessment hold?",
        criteria: {
          md_do: "A physician: MD, DO, or 'Dr.' with a medical license number",
          aprn: "An advanced practice registered nurse: APRN, ARNP, NP, FNP or FNP-C",
          pa: "A physician assistant: PA or PA-C",
          nurse_or_other: "Someone else: RN, LPN, CNA, medical assistant, office or facility staff",
          none: "No examiner credential or identity is shown",
        },
      },
      examiner_signed: signedBy("the examiner", "the health assessment"),
      alf_needs_met: {
        type: "choice",
        instructions: "What does the examiner answer about whether the individual's needs can be met in an assisted living facility?",
        criteria: {
          yes: "The examiner marks or writes that the needs can be met in an assisted living facility",
          no: "The examiner marks or writes that the needs cannot be met in an assisted living facility",
          not_answered: "The question is blank, both boxes are marked, or it cannot be told",
        },
      },
      communicable_disease: {
        type: "choice",
        instructions: "What does the examiner record about signs and symptoms of communicable disease?",
        criteria: {
          free: "The examiner records the individual as free of signs and symptoms of communicable disease",
          not_free: "The examiner records signs or symptoms of a communicable disease",
          not_answered: "The item is blank, contradictory, or cannot be told",
        },
      },
      sections_complete: {
        type: "noul",
        instructions: "Judged from the list of blank sections and the copied answers, the examiner completed every section of the form the examiner is responsible for.",
        criteria: {
          true: "No examiner section is blank and the examiner answers are present.",
          false: "One or more examiner sections are blank, or key examiner answers are missing.",
        },
      },
    },
    rules: {
      // Accepted examiners: 59A-36.006 "licensed health care provider". PA is TBD, confirm with Jessica.
      examiner_credential: { kind: "choice", label: "Examiner is a physician, APRN or PA", pass: ["md_do", "aprn", "pa"], fail: ["nurse_or_other", "none"] },
      examiner_signed: { kind: "noul", label: "Examiner signed", yes_is: "pass", note_on_fail: "Form 1823 without an examiner signature. Request a signed copy." },
      alf_needs_met: {
        kind: "choice",
        label: "Examiner says needs can be met in an ALF",
        pass: ["yes"],
        fail: ["no"],
        notes: { no: "The examiner says this person's needs cannot be met in an ALF. Administrator review before admission or retention." },
      },
      communicable_disease: {
        kind: "choice",
        label: "Free of communicable disease signs",
        pass: ["free"],
        fail: ["not_free"],
        notes: { not_free: "The examiner records signs of a communicable disease. Administrator review." },
      },
      sections_complete: { kind: "noul", label: "Examiner sections complete", yes_is: "pass" },
    },
  },

  face_sheet: {
    version: 1,
    evidence: {
      date_of_birth: { kind: "date", describe: "The resident's date of birth as printed." },
      admission_date: { kind: "date", describe: "The admission date as printed, when the face sheet shows one." },
      responsible_party_excerpt: { kind: "text", describe: "Copy the responsible party or emergency contact lines, with relationship and phone number." },
      source_excerpt: { kind: "text", describe: "Copy the header naming who produced the face sheet (facility, hospital or practice)." },
    },
    questions: {
      single_resident: {
        type: "noul",
        instructions: "The face sheet is about exactly one person.",
        criteria: { true: "One person's demographics are shown.", false: "It lists more than one person, or it is a roster." },
      },
      has_responsible_party: {
        type: "noul",
        instructions: "The face sheet lists at least one responsible party or emergency contact with a phone number.",
        criteria: { true: "A named contact with a phone number is present.", false: "No contact is listed, or the contact has no phone number." },
      },
    },
    rules: {
      single_resident: { kind: "noul", label: "About one resident", yes_is: "pass" },
      has_responsible_party: { kind: "noul", label: "Responsible party with phone", yes_is: "pass" },
    },
  },

  physician_orders: {
    version: 1,
    evidence: {
      order_date: { kind: "date", describe: "The date the orders were written or signed." },
      prescriber_line: { kind: "text", describe: "Copy the prescriber's printed name, credential and practice exactly as written." },
      prescriber_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
      source_excerpt: { kind: "text", describe: "Copy the header naming the source: clinic, pharmacy, hospital discharge, or hospice." },
      medication_count: { kind: "int", describe: "How many distinct medications are listed." },
    },
    questions: {
      prescriber_signed: signedBy("the prescriber", "the orders"),
      order_kind: {
        type: "choice",
        instructions: "What kind of physician order document is this?",
        criteria: {
          new_or_changed_orders: "New orders or changes to existing orders from a prescriber",
          medication_list_only: "A medication list or pharmacy printout with no new order",
          hospital_discharge_orders: "Orders or a medication reconciliation from a hospital or ER discharge",
          discontinue_only: "Only discontinues one or more medications",
          other: "Something else, or it cannot be told",
        },
      },
    },
    rules: {
      prescriber_signed: { kind: "noul", label: "Prescriber signed", yes_is: "pass", when: { question: "order_kind", in: ["new_or_changed_orders", "hospital_discharge_orders", "discontinue_only"] } },
      order_kind: {
        kind: "choice",
        notes: { hospital_discharge_orders: "Hospital discharge orders. Reconcile medications and check whether a Form 1823 renewal is due (BH-6)." },
      },
    },
  },

  advance_directive: {
    version: 1,
    evidence: {
      directive_title: { kind: "text", describe: "Copy the document title and any form number printed on it (for example DH 1896)." },
      signed_date: { kind: "date", describe: "The date the directive was signed." },
      patient_or_surrogate_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
      physician_signature: { kind: "text", describe: "For a DNRO, describe the physician signature line the same way. Otherwise null." },
      witness_excerpt: { kind: "text", describe: "Describe the witness lines: how many witnesses signed and whether names are printed." },
    },
    questions: {
      directive_kind: {
        type: "choice",
        instructions: "What kind of advance directive is this?",
        criteria: {
          dnro: "A Do Not Resuscitate Order (Florida DNRO, form DH 1896)",
          living_will: "A living will",
          health_care_surrogate: "A designation of health care surrogate",
          combined: "A combined document holding more than one of these",
          other: "Something else, or it cannot be told",
        },
      },
      patient_or_surrogate_signed: signedBy("the patient or their legal representative", "the directive"),
      physician_signed: signedBy("the physician", "the DNRO"),
    },
    rules: {
      directive_kind: { kind: "choice" },
      patient_or_surrogate_signed: { kind: "noul", label: "Patient or representative signed", yes_is: "pass" },
      physician_signed: {
        kind: "noul",
        label: "Physician signed the DNRO",
        yes_is: "pass",
        when: { question: "directive_kind", in: ["dnro"] },
        note_on_fail: "DNRO without a physician signature. Do not treat it as a valid order until a signed copy is on file.",
      },
    },
  },

  authority_instrument: {
    version: 1,
    evidence: {
      instrument_title: { kind: "text", describe: "Copy the document title exactly as written." },
      execution_date: { kind: "date", describe: "The date the principal signed, or the date the court issued the letters." },
      principal_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
      witness_excerpt: { kind: "text", describe: "Describe the witness lines: how many witnesses signed and whether names and addresses are printed." },
      notary_excerpt: { kind: "text", describe: "Copy the notary acknowledgment block: notary name, commission number, seal present or not." },
      court_excerpt: { kind: "text", describe: "For guardianship or court papers, copy the court name, case number and any clerk certification or seal text." },
      agent_names: { kind: "list", describe: "The agent, guardian, surrogate or payee names exactly as written." },
    },
    questions: {
      instrument_kind: {
        type: "choice",
        instructions: "What kind of authority document is this?",
        criteria: {
          durable_poa: "A durable power of attorney",
          health_care_surrogate: "A designation of health care surrogate",
          guardianship_letters: "Letters of guardianship or another court order appointing a guardian",
          representative_payee: "Social Security or VA representative payee papers",
          other: "Something else, or it cannot be told",
        },
      },
      principal_signed: signedBy("the principal", "the instrument"),
      two_witnesses: {
        type: "noul",
        instructions: "Two witnesses signed the instrument.",
        criteria: { true: "Two witness signatures are described.", false: "Fewer than two witness signatures, or it cannot be told." },
      },
      notarized: {
        type: "noul",
        instructions: "A notary acknowledgment is completed on the instrument.",
        criteria: { true: "The notary block names the notary and shows a seal or commission number.", false: "The notary block is missing, blank or incomplete." },
      },
      court_certified: {
        type: "noul",
        instructions: "The court papers carry a court clerk's certification or seal.",
        criteria: { true: "A clerk certification, seal, or certified copy stamp is described.", false: "No certification or seal is described." },
      },
    },
    rules: {
      // Execution formalities: F.S. 709.2105(2) (POA) and 765.202 (surrogate). Confirm with Donna.
      instrument_kind: { kind: "choice" },
      principal_signed: { kind: "noul", label: "Principal signed", yes_is: "pass", when: { question: "instrument_kind", in: ["durable_poa", "health_care_surrogate"] } },
      two_witnesses: { kind: "noul", label: "Two witnesses signed", yes_is: "pass", when: { question: "instrument_kind", in: ["durable_poa", "health_care_surrogate"] } },
      notarized: { kind: "noul", label: "Notarized", yes_is: "pass", when: { question: "instrument_kind", in: ["durable_poa"] } },
      court_certified: { kind: "noul", label: "Court certified", yes_is: "pass", when: { question: "instrument_kind", in: ["guardianship_letters"] } },
    },
  },

  insurance_card: {
    version: 1,
    evidence: {
      card_title: { kind: "text", describe: "Copy the plan or program name printed on the card." },
      effective_date: { kind: "date", describe: "The coverage effective date printed on the card." },
      member_id_last4: { kind: "text", describe: "Only the last four characters of the member ID." },
      sides_shown: { kind: "text", describe: "Describe which sides of the card appear: front, back, or both." },
    },
    questions: {
      card_kind: {
        type: "choice",
        instructions: "What kind of coverage card is this?",
        criteria: {
          medicare: "Original Medicare (red, white and blue card)",
          medicaid: "Florida Medicaid (state card)",
          medicare_advantage: "A Medicare Advantage plan card",
          medicaid_ltc_plan: "A Medicaid managed long-term care plan card",
          part_d: "A prescription drug plan card",
          supplement: "A Medicare supplement (Medigap) card",
          commercial: "Private or employer insurance",
          other: "Something else, or it cannot be told",
        },
      },
      both_sides: {
        type: "noul",
        instructions: "Both the front and the back of the card are in the file.",
        criteria: { true: "The front and the back are both present.", false: "Only one side is present." },
      },
    },
    rules: {
      card_kind: { kind: "choice" },
      both_sides: { kind: "noul", label: "Front and back present", yes_is: "pass" },
    },
  },

  photo_id: {
    version: 1,
    evidence: {
      date_of_birth: { kind: "date", describe: "The date of birth printed on the ID." },
      id_title: { kind: "text", describe: "Copy the ID type and issuing state or agency." },
    },
    questions: {
      photo_visible: {
        type: "noul",
        instructions: "The ID's photo and printed name are both visible in the scan.",
        criteria: { true: "The photo and the name can both be seen.", false: "The photo is missing, cut off or too dark, or the name cannot be read." },
      },
    },
    rules: {
      photo_visible: { kind: "noul", label: "Photo and name visible", yes_is: "pass" },
    },
  },

  admission_agreement: {
    version: 1,
    evidence: {
      agreement_title: { kind: "text", describe: "Copy the agreement title exactly as written." },
      effective_date: { kind: "date", describe: "The effective or signing date of the agreement." },
      facility_party_excerpt: { kind: "text", describe: "Copy the text naming the facility or provider party, including any legal entity name and address." },
      resident_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
      representative_signature: { kind: "text", describe: "Describe the responsible party or representative signature line the same way, or null when there is none." },
      facility_signature: { kind: "text", describe: "Describe the facility representative's signature line the same way." },
      initials_excerpt: { kind: "text", describe: "Describe the initial lines: how many there are and how many are initialed." },
    },
    questions: {
      resident_or_rep_signed: signedBy("the resident or their representative", "the agreement"),
      facility_signed: signedBy("the facility representative", "the agreement"),
      initials_complete: {
        type: "noul",
        instructions: "Every initial line the agreement asks for is initialed.",
        criteria: { true: "All initial lines are initialed, or the agreement has none.", false: "One or more initial lines are blank." },
      },
      names_this_facility: facilityMatch("the facility or provider party named in the agreement"),
    },
    rules: {
      resident_or_rep_signed: { kind: "noul", label: "Resident or representative signed", yes_is: "pass" },
      facility_signed: { kind: "noul", label: "Facility signed", yes_is: "pass" },
      initials_complete: { kind: "noul", label: "Initials complete", yes_is: "pass" },
      names_this_facility: { ...FACILITY_MATCH_RULE, label: "Names this facility's legal entity" },
    },
  },

  financial_agreement: {
    version: 1,
    evidence: {
      agreement_title: { kind: "text", describe: "Copy the agreement title exactly as written." },
      effective_date: { kind: "date", describe: "The effective or signing date." },
      facility_party_excerpt: { kind: "text", describe: "Copy the text naming the facility or provider party, including any legal entity name." },
      monthly_amount_excerpt: { kind: "text", describe: "Copy the line stating the monthly rate or amount owed." },
      responsible_party_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
      facility_signature: { kind: "text", describe: "Describe the facility representative's signature line the same way." },
    },
    questions: {
      responsible_party_signed: signedBy("the resident or the financially responsible party", "the agreement"),
      facility_signed: signedBy("the facility representative", "the agreement"),
      names_this_facility: facilityMatch("the facility or provider party named in the agreement"),
    },
    rules: {
      responsible_party_signed: { kind: "noul", label: "Responsible party signed", yes_is: "pass" },
      facility_signed: { kind: "noul", label: "Facility signed", yes_is: "pass" },
      names_this_facility: { ...FACILITY_MATCH_RULE, label: "Names this facility's legal entity" },
    },
  },

  tb_screening: {
    version: 1,
    evidence: {
      administered_date: { kind: "date", describe: "The date the test was placed, drawn or taken." },
      read_date: { kind: "date", describe: "For a skin test, the date it was read. Otherwise null." },
      induration_mm: { kind: "int", describe: "For a skin test, the induration in millimeters as written. Otherwise null." },
      result_excerpt: { kind: "text", describe: "Copy the result line exactly as written." },
      reader_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
    },
    questions: {
      test_kind: tbTestKind(),
      tb_result: tbResult(),
      clinician_signed: signedBy("the clinician who read or reported the result", "the record"),
    },
    rules: {
      test_kind: { kind: "choice" },
      tb_result: TB_RESULT_RULE,
      clinician_signed: { kind: "noul", label: "Clinician signed the result", yes_is: "pass" },
    },
  },

  resident_consent: {
    version: 1,
    evidence: {
      consent_title: { kind: "text", describe: "Copy the consent or acknowledgment title exactly as written." },
      signed_date: { kind: "date", describe: "The signing date." },
      signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
    },
    questions: {
      consent_kind: {
        type: "choice",
        instructions: "What does the resident or representative consent to or acknowledge?",
        criteria: {
          resident_rights: "Receipt of the resident bill of rights or grievance procedure",
          hipaa_notice: "Receipt of the notice of privacy practices",
          photo_release: "Permission to photograph or record",
          other: "Something else, or it cannot be told",
        },
      },
      signed_by_resident_or_rep: signedBy("the resident or their representative", "the acknowledgment"),
    },
    rules: {
      consent_kind: { kind: "choice" },
      signed_by_resident_or_rep: { kind: "noul", label: "Resident or representative signed", yes_is: "pass" },
    },
  },

  resident_other: {
    version: 1,
    evidence: {
      document_title: { kind: "text", describe: "Copy the document title or heading exactly as written." },
      source_excerpt: { kind: "text", describe: "Copy the name of the organization that produced it." },
      event_dates_excerpt: { kind: "text", describe: "Copy any admission, discharge, visit or collection dates as written." },
    },
    questions: {
      other_kind: {
        type: "choice",
        instructions: "What kind of resident document is this?",
        criteria: {
          hospital_or_er_discharge: "Hospital or emergency room discharge papers or a discharge summary",
          lab_or_imaging_result: "A lab, imaging or test result",
          specialist_or_clinic_note: "A visit note from a specialist, clinic, therapy or home health",
          correspondence: "A letter or notice about the resident that is not clinical",
          other: "Something else, or it cannot be told",
        },
      },
    },
    rules: {
      other_kind: {
        kind: "choice",
        notes: { hospital_or_er_discharge: "Hospital or ER discharge. Check whether a Form 1823 renewal is due and reconcile medications (BH-6)." },
      },
    },
  },

  // ── Medicaid ──────────────────────────────────────────────────────────────

  medicaid_letter: {
    version: 1,
    evidence: {
      sending_agency: { kind: "text", describe: "Copy the agency or plan name in the letterhead." },
      notice_date: { kind: "date", describe: "The date printed on the notice." },
      purpose_excerpt: { kind: "text", describe: "Copy the one or two sentences that state the decision or the request." },
      requested_items_excerpt: { kind: "text", describe: "Copy the list of documents or information requested, when there is one." },
      deadline_excerpt: { kind: "text", describe: "Copy every sentence that states a date or period by which someone must respond, send documents or ask for a hearing." },
      deadline_date: { kind: "date", describe: "The response or hearing-request date, only when a calendar date is printed." },
      deadline_days: { kind: "int", describe: "When the deadline is stated as 'within N days', the N. Otherwise null." },
      program_excerpt: { kind: "text", describe: "Copy the program named (ICP, SMMC LTC, OSS, QMB, SLMB, MEDS-AD or other)." },
      effective_date: { kind: "date", describe: "The date the decision takes effect, when stated." },
    },
    questions: {
      letter_kind: {
        type: "choice",
        instructions: "What is this Medicaid or benefits letter telling the reader?",
        criteria: {
          approval: "Benefits are approved or continued",
          denial: "An application or service is denied",
          request_for_information: "The agency needs documents or information before it can decide",
          renewal_or_redetermination: "A renewal or redetermination is due or has started",
          reduction_or_termination: "Benefits are being reduced, changed or ended",
          hearing_notice: "A fair hearing is scheduled or its outcome is reported",
          informational: "General information with no decision and no request",
        },
      },
      deadline_stated: {
        type: "noul",
        instructions: "The letter states a date or period by which someone must respond, send documents, or request a hearing.",
        criteria: { true: "A response, submission or hearing-request deadline is stated.", false: "No deadline is stated." },
      },
      deadline_from_notice_date: {
        type: "noul",
        instructions: "The 'within N days' period in the letter runs from the date printed on the notice.",
        criteria: {
          true: "The period is counted from the date of the notice or the date the notice was mailed.",
          false: "The period runs from receipt, from another event, or the letter gives a calendar date instead.",
        },
      },
    },
    rules: {
      letter_kind: {
        kind: "choice",
        notes: {
          denial: "Denial. Check the hearing-request deadline below and tell the Medicaid case owner.",
          request_for_information: "Request for information. The listed items are owed by the deadline below.",
          reduction_or_termination: "Benefits reduced or ending. Check the hearing-request deadline below.",
          renewal_or_redetermination: "Renewal or redetermination. Open the renewal on the Medicaid case.",
          hearing_notice: "Fair hearing notice. Put the hearing date in front of the case owner.",
        },
      },
      // Recorded only. Both feed the code check `medicaid_response_deadline` in intake-type-checks.ts.
      deadline_stated: { kind: "noul", yes_is: "pass" },
      deadline_from_notice_date: { kind: "noul", yes_is: "pass" },
    },
  },

  medicaid_application_doc: {
    version: 1,
    evidence: {
      document_title: { kind: "text", describe: "Copy the document title or statement name." },
      period_start: { kind: "date", describe: "The statement period start date, when shown." },
      period_end: { kind: "date", describe: "The statement period end date, or the letter date." },
      account_last4: { kind: "text", describe: "Only the last four digits of any account number." },
    },
    questions: {
      app_doc_kind: {
        type: "choice",
        instructions: "What kind of Medicaid application document is this?",
        criteria: {
          bank_statement: "A bank or credit union statement",
          income_or_benefit_letter: "A Social Security, pension, VA or other income or benefit letter",
          asset_or_insurance_statement: "A life insurance, annuity, investment or property statement",
          identity_or_citizenship: "Proof of identity, citizenship or residency",
          dcf_form: "A DCF or AHCA form (for example 701B or 3008)",
          other: "Something else, or it cannot be told",
        },
      },
    },
    rules: { app_doc_kind: { kind: "choice" } },
  },

  // ── Staff ─────────────────────────────────────────────────────────────────

  staff_certification: {
    version: 1,
    evidence: {
      certificate_title: { kind: "text", describe: "Copy the certificate or license title exactly as written." },
      issuing_body: { kind: "text", describe: "Copy the issuing organization or board." },
      issue_date: { kind: "date", describe: "The issue or completion date." },
      credential_last4: { kind: "text", describe: "Only the last four characters of any certificate or license number." },
    },
    questions: {
      cert_kind: {
        type: "choice",
        instructions: "What credential does this document show?",
        criteria: {
          cpr: "CPR or BLS",
          first_aid: "First aid",
          cna_or_nursing_license: "A CNA certificate or a nursing license",
          medication_assistance_training: "Assistance with self-administered medication training",
          alf_core_training: "ALF core training",
          alf_core_competency_test: "The ALF core training competency test",
          inservice_other: "An in-service or other required training certificate",
          other: "Something else, or it cannot be told",
        },
      },
      issued_credential: {
        type: "noul",
        instructions: "This is an issued certificate, card or license, not a course roster, registration receipt or confirmation email.",
        criteria: { true: "It presents as the issued credential.", false: "It is a roster, receipt, enrollment confirmation or email." },
      },
    },
    rules: {
      cert_kind: { kind: "choice" },
      issued_credential: { kind: "noul", label: "Issued credential, not a receipt", yes_is: "pass" },
    },
  },

  staff_training: {
    version: 1,
    evidence: {
      training_topic: { kind: "text", describe: "Copy the training topic or course title." },
      training_date: { kind: "date", describe: "The date of the training." },
      hours_excerpt: { kind: "text", describe: "Copy the hours or credit stated." },
      trainer_line: { kind: "text", describe: "Copy the trainer's printed name and credential, and describe the trainer signature line." },
      attendee_count: { kind: "int", describe: "How many different people are listed as attending." },
    },
    questions: {
      record_kind: {
        type: "choice",
        instructions: "What kind of training record is this?",
        criteria: {
          individual_certificate: "A certificate or record for one person",
          sign_in_sheet: "A sign-in sheet or roster listing several people",
          other: "Something else, or it cannot be told",
        },
      },
      trainer_identified: {
        type: "noul",
        instructions: "The trainer is identified by name and has signed or certified the record.",
        criteria: { true: "A named trainer signed or certified it.", false: "No trainer is named, or the trainer line is unsigned." },
      },
    },
    rules: {
      record_kind: {
        kind: "choice",
        notes: { sign_in_sheet: "Sign-in sheet for several people. File it to each attendee's file or split it." },
      },
      trainer_identified: { kind: "noul", label: "Trainer identified and signed", yes_is: "pass" },
    },
  },

  staff_personnel: {
    version: 1,
    evidence: {
      document_title: { kind: "text", describe: "Copy the document title exactly as written." },
      signed_date: { kind: "date", describe: "The signing or issue date." },
      signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
      screening_excerpt: { kind: "text", describe: "For a background screening result, copy the eligibility determination line. Otherwise null." },
    },
    questions: {
      personnel_kind: {
        type: "choice",
        instructions: "What kind of personnel document is this?",
        criteria: {
          application: "An employment application",
          work_eligibility: "An I-9 or identity and work eligibility document",
          background_screening_result: "An AHCA Clearinghouse or other background screening result",
          reference: "A reference or employment verification",
          signed_acknowledgment: "A signed policy, handbook or conditions-of-employment acknowledgment",
          other: "Something else, or it cannot be told",
        },
      },
      signed_where_required: signedBy("the employee", "the document"),
      screening_eligibility: {
        type: "choice",
        instructions: "What eligibility determination does the screening result record?",
        criteria: {
          eligible: "Eligible",
          not_eligible: "Not eligible",
          pending: "Pending, in process, or awaiting results",
          not_a_screening: "This is not a screening result",
        },
      },
    },
    rules: {
      personnel_kind: { kind: "choice" },
      signed_where_required: { kind: "noul", label: "Employee signed", yes_is: "pass", when: { question: "personnel_kind", in: ["application", "signed_acknowledgment"] } },
      screening_eligibility: {
        kind: "choice",
        label: "Screening eligible",
        pass: ["eligible"],
        fail: ["not_eligible"],
        when: { question: "personnel_kind", in: ["background_screening_result"] },
        notes: {
          not_eligible: "Screening result is not eligible. Administrator review before any shift.",
          pending: "Screening result is pending. Administrator review before any unsupervised shift.",
        },
      },
    },
  },

  staff_medical: {
    version: 1,
    evidence: {
      record_title: { kind: "text", describe: "Copy the record title exactly as written." },
      administered_date: { kind: "date", describe: "The test, exam or vaccination date." },
      read_date: { kind: "date", describe: "For a skin test, the date it was read. Otherwise null." },
      induration_mm: { kind: "int", describe: "For a skin test, the induration in millimeters as written. Otherwise null." },
      result_excerpt: { kind: "text", describe: "Copy the result line exactly as written." },
      clinician_signature: { kind: "text", describe: SIGNATURE_DESCRIBE },
    },
    questions: {
      medical_kind: {
        type: "choice",
        instructions: "What kind of employee health record is this?",
        criteria: {
          tb_test: "A tuberculosis screening",
          physical_or_good_health: "A physical exam or statement of good health",
          hepatitis_b: "A hepatitis B vaccination record or declination",
          other: "Something else, or it cannot be told",
        },
      },
      test_kind: tbTestKind(),
      tb_result: tbResult(),
      clinician_signed: signedBy("the clinician", "the record"),
    },
    rules: {
      medical_kind: { kind: "choice" },
      test_kind: { kind: "choice", when: { question: "medical_kind", in: ["tb_test"] } },
      tb_result: { ...TB_RESULT_RULE, when: { question: "medical_kind", in: ["tb_test"] } },
      clinician_signed: { kind: "noul", label: "Clinician signed", yes_is: "pass", when: { question: "medical_kind", in: ["tb_test", "physical_or_good_health"] } },
    },
  },

  // ── Facility and vendor ───────────────────────────────────────────────────

  facility_license: {
    version: 1,
    evidence: {
      license_title: { kind: "text", describe: "Copy the license or permit title and issuing agency." },
      licensee_excerpt: { kind: "text", describe: "Copy the licensee name, DBA and licensed address exactly as written." },
      license_number: { kind: "text", describe: "The license or permit number exactly as written." },
      license_type_excerpt: { kind: "text", describe: "Copy the license type and any specialty licenses (Standard, LNS, ECC, LMH)." },
      effective_date: { kind: "date", describe: "The effective or issue date." },
      licensed_capacity: { kind: "int", describe: "The licensed bed capacity, when printed." },
    },
    questions: {
      license_kind: {
        type: "choice",
        instructions: "What kind of license or permit is this?",
        criteria: {
          ahca_alf_license: "An AHCA assisted living facility license",
          food_service_license: "A food service or kitchen license or permit",
          local_business_tax_receipt: "A county or city business tax receipt",
          other_permit: "Another permit, or it cannot be told",
        },
      },
      names_this_facility: facilityMatch("the licensee, DBA and licensed address"),
    },
    rules: {
      license_kind: { kind: "choice" },
      names_this_facility: FACILITY_MATCH_RULE,
    },
  },

  facility_inspection: {
    version: 1,
    evidence: {
      inspection_title: { kind: "text", describe: "Copy the report title and the inspecting agency or company." },
      inspection_date: { kind: "date", describe: "The inspection date." },
      premises_excerpt: { kind: "text", describe: "Copy the establishment name and address inspected." },
      result_excerpt: { kind: "text", describe: "Copy the overall result or disposition line." },
      violations_excerpt: { kind: "text", describe: "Copy the violation or deficiency lines, at most the first three." },
      correction_due_date: { kind: "date", describe: "The date corrections are due or the re-inspection date, when stated." },
    },
    questions: {
      inspection_kind: {
        type: "choice",
        instructions: "What kind of inspection is this?",
        criteria: {
          food_or_sanitation: "Health department food service or sanitation",
          elevator: "Elevator",
          sprinkler_or_backflow: "Sprinkler system or backflow prevention",
          other: "Something else, or it cannot be told",
        },
      },
      inspection_result: {
        type: "choice",
        instructions: "What is the overall outcome of the inspection?",
        criteria: {
          passed: "Passed or satisfactory with no corrections required",
          passed_with_corrections: "Passed or met standards but corrections are required",
          failed: "Failed, unsatisfactory, or a re-inspection is required before approval",
          not_stated: "No outcome is stated",
        },
      },
      names_this_facility: facilityMatch("the establishment name and address inspected"),
    },
    rules: {
      inspection_kind: { kind: "choice" },
      inspection_result: {
        kind: "choice",
        label: "Inspection passed",
        pass: ["passed"],
        fail: ["failed"],
        notes: { passed_with_corrections: "Corrections required. Track the correction date below.", failed: "Inspection failed. Administrator review." },
      },
      names_this_facility: FACILITY_MATCH_RULE,
    },
  },

  facility_fire: {
    version: 1,
    evidence: {
      inspection_title: { kind: "text", describe: "Copy the report title and the inspecting agency or company." },
      inspection_date: { kind: "date", describe: "The inspection or test date." },
      premises_excerpt: { kind: "text", describe: "Copy the premises name and address." },
      result_excerpt: { kind: "text", describe: "Copy the overall result line." },
      violations_excerpt: { kind: "text", describe: "Copy the violation or deficiency lines, at most the first three." },
      correction_due_date: { kind: "date", describe: "The date corrections are due or the re-inspection date, when stated." },
    },
    questions: {
      fire_kind: {
        type: "choice",
        instructions: "What kind of fire inspection or test is this?",
        criteria: {
          fire_marshal: "A fire marshal or fire department inspection",
          alarm_test: "A fire alarm system inspection or test",
          sprinkler: "A sprinkler system inspection",
          extinguisher: "Fire extinguisher service",
          other: "Something else, or it cannot be told",
        },
      },
      inspection_result: {
        type: "choice",
        instructions: "What is the overall outcome?",
        criteria: {
          passed: "Passed or satisfactory with no corrections required",
          passed_with_corrections: "Passed but corrections are required",
          failed: "Failed, impaired, or deficient",
          not_stated: "No outcome is stated",
        },
      },
      names_this_facility: facilityMatch("the premises name and address"),
    },
    rules: {
      fire_kind: { kind: "choice" },
      inspection_result: {
        kind: "choice",
        label: "Fire inspection passed",
        pass: ["passed"],
        fail: ["failed"],
        notes: { passed_with_corrections: "Corrections required. Track the correction date below.", failed: "Fire inspection failed or system impaired. Administrator review now." },
      },
      names_this_facility: FACILITY_MATCH_RULE,
    },
  },

  facility_generator: {
    version: 1,
    evidence: {
      service_date: { kind: "date", describe: "The service or test date." },
      service_excerpt: { kind: "text", describe: "Copy the service type line (load test, preventive maintenance, repair)." },
      premises_excerpt: { kind: "text", describe: "Copy the site name and address." },
      run_minutes: { kind: "int", describe: "Minutes the generator ran under test, when stated." },
      load_percent: { kind: "int", describe: "Percent load reached, when stated." },
      deficiencies_excerpt: { kind: "text", describe: "Copy any deficiency, failure or recommendation lines." },
      next_service_date: { kind: "date", describe: "The next service or test due date, when stated." },
    },
    questions: {
      service_kind: {
        type: "choice",
        instructions: "What kind of generator service is this?",
        criteria: {
          load_test: "A load test or load bank test",
          preventive_maintenance: "Scheduled preventive maintenance",
          repair: "A repair or service call",
          other: "Something else, or it cannot be told",
        },
      },
      deficiency_noted: {
        type: "noul",
        instructions: "The technician noted a deficiency, failure, or a repair that is still needed.",
        criteria: { true: "A deficiency, failure or open repair is noted.", false: "No deficiency is noted." },
      },
      names_this_facility: facilityMatch("the site name and address"),
    },
    rules: {
      service_kind: { kind: "choice" },
      deficiency_noted: { kind: "noul", label: "No open generator deficiency", yes_is: "fail", note_on_fail: "Generator deficiency noted. Maintenance and Administrator review." },
      names_this_facility: FACILITY_MATCH_RULE,
    },
  },

  facility_pest: {
    version: 1,
    evidence: {
      service_date: { kind: "date", describe: "The service date." },
      premises_excerpt: { kind: "text", describe: "Copy the service address." },
      findings_excerpt: { kind: "text", describe: "Copy the findings, activity observed, and areas treated." },
      next_service_date: { kind: "date", describe: "The next scheduled service date, when stated." },
    },
    questions: {
      activity_found: {
        type: "noul",
        instructions: "The technician found pest activity.",
        criteria: { true: "Activity, evidence, or sightings of pests are recorded.", false: "No activity is recorded; routine service only." },
      },
      names_this_facility: facilityMatch("the service address"),
    },
    rules: {
      activity_found: { kind: "noul", label: "No pest activity found", yes_is: "fail", note_on_fail: "Pest activity recorded. Maintenance follow-up." },
      names_this_facility: FACILITY_MATCH_RULE,
    },
  },

  facility_survey: {
    version: 1,
    evidence: {
      survey_title: { kind: "text", describe: "Copy the document title and survey type." },
      exit_date: { kind: "date", describe: "The survey exit date." },
      provider_excerpt: { kind: "text", describe: "Copy the provider name, license number and address." },
      tags_cited: { kind: "list", describe: "Each deficiency tag or rule number cited, as written." },
      poc_due_date: { kind: "date", describe: "The date the plan of correction is due, when stated." },
      correction_date: { kind: "date", describe: "The date by which corrections must be completed, when stated." },
    },
    questions: {
      survey_doc_kind: {
        type: "choice",
        instructions: "What kind of survey document is this?",
        criteria: {
          statement_of_deficiencies: "A statement of deficiencies",
          plan_of_correction: "A plan of correction",
          revisit_or_clearance: "A revisit report or a letter clearing deficiencies",
          no_deficiency_letter: "A letter stating no deficiencies were cited",
          other: "Something else, or it cannot be told",
        },
      },
      deficiencies_cited: {
        type: "noul",
        instructions: "The document cites one or more deficiencies against the facility.",
        criteria: { true: "At least one deficiency is cited.", false: "No deficiency is cited." },
      },
      names_this_facility: facilityMatch("the provider name, license number and address"),
    },
    rules: {
      survey_doc_kind: { kind: "choice" },
      deficiencies_cited: { kind: "noul", label: "No deficiencies cited", yes_is: "fail", note_on_fail: "Survey deficiencies cited. Plan of correction deadline below." },
      names_this_facility: FACILITY_MATCH_RULE,
    },
  },

  facility_insurance: {
    version: 1,
    evidence: {
      form_title: { kind: "text", describe: "Copy the form title or number (ACORD 25, ACORD 28, declarations page)." },
      named_insured_excerpt: { kind: "text", describe: "Copy the named insured and insured address, and any location schedule entries." },
      carrier_excerpt: { kind: "text", describe: "Copy the insurer name and the policy number with all but the last four characters replaced by asterisks." },
      policy_start: { kind: "date", describe: "The policy period start date." },
      policy_end: { kind: "date", describe: "The policy period end date." },
      coverage_excerpt: { kind: "text", describe: "Copy the coverage lines and limits." },
      draft_marks_excerpt: { kind: "text", describe: "Copy any 'draft', 'proof', 'specimen' or 'for review' marks, and describe unsigned signature boxes. Null when none." },
    },
    questions: {
      names_this_facility: facilityMatch("the named insured, insured address and location schedule"),
      // Wording and bands reused from compliance-doc-questions.ts (calibrated 2026-09-16 on nine COL documents).
      is_draft: {
        type: "noul",
        instructions: "This document is a draft, proof, specimen, or sample rather than an issued document",
        criteria: {
          true: "It is marked draft, proof, specimen, sample, or 'for review only', or carries an unfilled signature or countersignature block",
          false: "It presents as an issued, in-force document",
        },
      },
      carrier_and_policy_identified: {
        type: "noul",
        instructions: "A named insurance carrier and a policy number are both present and legible on this document",
        criteria: {
          true: "Both an underwriting carrier's name and a policy number appear and can be read",
          false: "Either is missing, illegible, shown as TBD or pending, or only a broker, agency, or program name appears in place of the carrier",
        },
      },
    },
    rules: {
      names_this_facility: FACILITY_MATCH_RULE,
      is_draft: { kind: "noul", label: "Issued, not a draft", yes_is: "fail", band: { low: 0.35, high: 0.7 } },
      carrier_and_policy_identified: { kind: "noul", label: "Carrier and policy identified", yes_is: "pass", band: { low: 0.4, high: 0.65 } },
    },
  },

  vendor_coi: {
    version: 1,
    evidence: {
      certificate_holder_excerpt: { kind: "text", describe: "Copy the certificate holder box exactly as written." },
      additional_insured_excerpt: { kind: "text", describe: "Copy any additional insured wording and whom it names. Null when none." },
      issue_date: { kind: "date", describe: "The certificate date." },
      gl_policy_end: { kind: "date", describe: "The general liability policy expiration date." },
      wc_policy_end: { kind: "date", describe: "The workers compensation policy expiration date, or null." },
      auto_policy_end: { kind: "date", describe: "The automobile liability policy expiration date, or null." },
      gl_each_occurrence_excerpt: { kind: "text", describe: "Copy the general liability each-occurrence limit as written." },
      draft_marks_excerpt: { kind: "text", describe: "Copy any 'draft', 'proof', 'specimen' or 'for review' marks. Null when none." },
    },
    questions: {
      names_this_facility: facilityMatch("the certificate holder"),
      additional_insured_named: {
        type: "noul",
        instructions: "The certificate names the facility or Circle of Life as an additional insured.",
        criteria: { true: "Additional insured wording names the facility, its legal entity, or Circle of Life.", false: "No additional insured wording, or it names someone else." },
      },
      is_draft: {
        type: "noul",
        instructions: "This document is a draft, proof, specimen, or sample rather than an issued document",
        criteria: {
          true: "It is marked draft, proof, specimen, sample, or 'for review only', or carries an unfilled signature or countersignature block",
          false: "It presents as an issued, in-force document",
        },
      },
    },
    rules: {
      names_this_facility: { ...FACILITY_MATCH_RULE, label: "Certificate holder is this facility" },
      // Recorded only: whether additional insured status is required depends on the vendor's contract.
      additional_insured_named: { kind: "noul", yes_is: "pass" },
      is_draft: { kind: "noul", label: "Issued, not a draft", yes_is: "fail", band: { low: 0.35, high: 0.7 } },
    },
  },

  vendor_contract: {
    version: 1,
    evidence: {
      document_title: { kind: "text", describe: "Copy the document title exactly as written." },
      counterparty_excerpt: { kind: "text", describe: "Copy the vendor's legal name and the Circle of Life party named." },
      effective_date: { kind: "date", describe: "The effective date." },
      term_end_date: { kind: "date", describe: "The date the current term ends, when stated." },
      termination_notice_days: { kind: "int", describe: "The days of notice required to cancel or prevent renewal, when stated." },
      auto_renew_excerpt: { kind: "text", describe: "Copy the renewal clause, when there is one." },
      signatures_excerpt: { kind: "text", describe: "Describe each signature line: which party, signed or blank." },
      resident_information_excerpt: { kind: "text", describe: "Copy any sentence about access to resident, patient, medical or health information. Null when none." },
    },
    questions: {
      contract_kind: {
        type: "choice",
        instructions: "What kind of vendor document is this?",
        criteria: {
          service_agreement: "A service agreement or contract",
          amendment_or_renewal: "An amendment, addendum or renewal",
          w9: "A W-9",
          business_associate_agreement: "A business associate agreement",
          quote_or_proposal: "A quote, estimate or proposal not yet accepted",
          other: "Something else, or it cannot be told",
        },
      },
      fully_executed: {
        type: "noul",
        instructions: "Both the vendor and the Circle of Life party signed the document.",
        criteria: { true: "Both parties' signature lines are signed.", false: "One or both parties' lines are blank or missing." },
      },
      auto_renews: {
        type: "noul",
        instructions: "The contract renews automatically unless someone cancels.",
        criteria: { true: "A clause renews the term automatically.", false: "No automatic renewal." },
      },
      vendor_touches_resident_info: {
        type: "noul",
        instructions: "Under this document the vendor will create, receive, store or transmit resident health or personal information.",
        criteria: {
          true: "The services involve resident records, medications, clinical data, or resident personal information.",
          false: "The services do not involve resident information.",
        },
      },
      names_this_facility: facilityMatch("the Circle of Life party named in the document"),
    },
    rules: {
      contract_kind: { kind: "choice", notes: { quote_or_proposal: "Quote or proposal, not a signed contract." } },
      fully_executed: { kind: "noul", label: "Signed by both parties", yes_is: "pass", when: { question: "contract_kind", in: ["service_agreement", "amendment_or_renewal", "business_associate_agreement"] } },
      auto_renews: { kind: "noul", label: "Does not auto-renew", yes_is: "fail", note_on_fail: "Auto-renews. Watch the cancel-by date below." },
      vendor_touches_resident_info: {
        kind: "noul",
        label: "No resident information involved",
        yes_is: "fail",
        note_on_fail: "This vendor may handle resident information. Confirm a signed BAA is on file in Notion Vendors.",
      },
      names_this_facility: FACILITY_MATCH_RULE,
    },
  },

  facility_other: { version: 1, evidence: {}, questions: {}, rules: {} },
  unknown: { version: 1, evidence: {}, questions: {}, rules: {} },
};

// ── Builders ────────────────────────────────────────────────────────────────

const GENERIC_SET: TypeQuestionSet = { version: 1, evidence: {}, questions: {}, rules: {} };

/** The set for a catalog code; codes without one get only the common questions. */
export function typeQuestionSet(code: string): TypeQuestionSet {
  return INTAKE_TYPE_QUESTIONS[code] ?? GENERIC_SET;
}

/** Recorded on every proposal as `jev.questions_version`. */
export function questionsVersion(code: string): string {
  return `${INTAKE_QUESTIONS_VERSION}/${code}.${typeQuestionSet(code).version}`;
}

/** Evidence fields the reader returns for a code: common plus type fields. */
export function evidenceFields(code: string): Record<string, EvidenceField> {
  return { ...COMMON_EVIDENCE, ...typeQuestionSet(code).evidence };
}

/** Rules for a code, including the common questions. */
export function answerRules(code: string): Record<string, AnswerRule> {
  return {
    type_matches: { kind: "noul", label: "Jev agrees on the document type", yes_is: "pass", note_on_fail: "Jev doubts the document type. Confirm the type before filing." },
    legible_complete: { kind: "noul", label: "Legible and complete", yes_is: "pass" },
    ...typeQuestionSet(code).rules,
  };
}

/**
 * Every question Jev gets for one document. `candidates` are the ranked
 * destination labels (code's short list); the destination question is asked
 * only when there is at least one. Keys c0..cN map to candidates[i].
 */
export function buildIntakeQuestions(args: { code: string; label: string; candidates: string[] }): Record<string, SystemOneQuestion> {
  const questions: Record<string, SystemOneQuestion> = {};
  if (args.candidates.length > 0) {
    const criteria: Record<string, string> = {};
    args.candidates.forEach((candidate, i) => {
      criteria[`c${i}`] = `The document is about ${candidate}.`;
    });
    criteria.none = "The document is about none of the listed destinations, or it cannot be told which.";
    questions.destination = {
      type: "choice",
      instructions: "Given the document's type, the names found in it and the evidence copied from it, which listed destination is this document about?",
      criteria,
    };
  }
  questions.type_matches = {
    type: "noul",
    instructions: `Judged from the title, summary and evidence, this document is a ${args.label}.`,
    criteria: {
      true: `The evidence is consistent with a ${args.label}.`,
      false: `The evidence describes a different kind of document, or several documents.`,
    },
  };
  questions.legible_complete = {
    type: "noul",
    instructions: "Judged from the reader's notes, the page markers and the evidence copied from the document, this is a complete and legible copy.",
    criteria: {
      true: "Every page the document refers to is present and the copied text reads cleanly.",
      false: "Pages are missing or cut off, parts are blank or unreadable, or the copied evidence shows gaps.",
    },
  };
  return { ...questions, ...typeQuestionSet(args.code).questions };
}

/**
 * The EVIDENCE section of the reader's system prompt. One block per active
 * code: the reader fills only the block for the code it chose.
 */
export function readerEvidencePrompt(codes: string[]): string {
  const lines: string[] = [
    "EVIDENCE: return `evidence` as an object holding only the keys listed for the catalog_code you chose.",
    "- text: copy exactly as written, at most 300 characters. Where the field says describe, describe what you see in one sentence.",
    "- date: YYYY-MM-DD. int: a whole number. list: up to 20 short strings.",
    "- null when the document does not show it. Never guess. Never write more than the last four digits of any ID, account or policy number.",
  ];
  for (const code of codes) {
    const fields = evidenceFields(code);
    lines.push(`${code}:`);
    for (const [key, field] of Object.entries(fields)) {
      lines.push(`  ${key} (${field.kind}): ${field.describe}`);
    }
  }
  return lines.join("\n");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Keep only the fields defined for `code`, typed and clipped. A wrong type is
 * dropped to null with a note; it never fails a document that was otherwise
 * read. `mask` is applied to every string (maskIdentifiers in the handler).
 */
export function parseEvidence(
  code: string,
  raw: unknown,
  mask: (text: string) => string,
): { evidence: Evidence; notes: string[] } {
  const fields = evidenceFields(code);
  const evidence: Evidence = {};
  const notes: string[] = [];
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (raw !== undefined && raw !== null && source !== raw) notes.push("evidence_not_object");
  for (const [key, field] of Object.entries(fields)) {
    const value = source[key];
    if (value === undefined || value === null) {
      evidence[key] = null;
      continue;
    }
    switch (field.kind) {
      case "text":
        if (typeof value === "string" && value.trim()) evidence[key] = mask(value.trim()).slice(0, EVIDENCE_TEXT_MAX);
        else { evidence[key] = null; notes.push(`evidence_invalid:${key}`); }
        break;
      case "date":
        if (typeof value === "string" && isRealDate(value)) evidence[key] = value;
        else { evidence[key] = null; notes.push(`evidence_invalid:${key}`); }
        break;
      case "int":
        if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100000) evidence[key] = value;
        else { evidence[key] = null; notes.push(`evidence_invalid:${key}`); }
        break;
      case "list":
        if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
          evidence[key] = (value as string[]).map((v) => mask(v.trim()).slice(0, 200)).filter(Boolean).slice(0, EVIDENCE_LIST_MAX);
        } else { evidence[key] = null; notes.push(`evidence_invalid:${key}`); }
        break;
    }
  }
  return { evidence, notes };
}
