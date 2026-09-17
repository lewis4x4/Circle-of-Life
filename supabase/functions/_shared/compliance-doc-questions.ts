/**
 * compliance-doc-questions — the HUD 232 / Berkadia document judgments.
 *
 * Every question and every threshold lives here and nowhere else. The handler
 * composes answers into a route; it does not define what is being asked. When a
 * threshold moves, bump `QUESTIONS_VERSION` so a triage row recorded under the
 * old wording is never compared against a row recorded under the new one.
 *
 * Scope: facility insurance documents only — certificates, endorsements,
 * evidence of property insurance, flood, premium invoices. Nothing here reads a
 * resident record, and nothing here may be pointed at one: TypeSafe is a new AI
 * subprocessor with no BAA on file, so the state sent to it must stay PHI-free.
 *
 * Why the mortgagee wording is three questions and not one:
 * HUD 232 requires Berkadia Commercial Mortgage LLC *and* the Assistant
 * Secretary for Housing *and* ISAOA/ATIMA. Asked as a single conjunction, a 0.4
 * tells you the wording is wrong but not which party is missing — which is the
 * only thing the email back to the agent needs to say. Asked separately they
 * still cost one round trip, because questions in a request run in parallel.
 */

import type { SystemOneQuestion } from "./typesafe-client.ts";

/** Bump when any wording or threshold below changes. Recorded on every row. */
export const QUESTIONS_VERSION = "compliance-doc-check-v2";

export const COMPLIANCE_QUESTIONS: Record<string, SystemOneQuestion> = {
  doc_type: {
    type: "choice",
    instructions: "What kind of insurance document is this?",
    criteria: {
      evidence_of_property_insurance:
        "ACORD 28 or equivalent evidence of commercial property insurance, showing limits and a mortgagee or loss payee box",
      mortgagee_endorsement:
        "An endorsement whose purpose is to name, add, or change the mortgagee or loss payee on a policy",
      epi_endorsement:
        "An extended period of indemnity endorsement, or a business income extension stating a number of days of continued coverage after restoration",
      liability_certificate:
        "ACORD 25 or equivalent certificate of general or professional liability insurance",
      flood: "A flood policy, flood declaration page, or FEMA flood zone determination",
      invoice: "A premium invoice, premium finance agreement, or account statement",
      other:
        "An insurance-related document that is none of the above, or a document whose kind cannot be determined from the text",
    },
  },

  facility_named: {
    type: "choice",
    instructions:
      "Which Circle of Life assisted living facility does this document cover, judged from the named insured, the location schedule, and any property address on the document?",
    criteria: {
      homewood_lodge: "Homewood Lodge ALF",
      oakridge: "Oakridge ALF",
      rising_oaks: "Rising Oaks ALF",
      grande_cypress: "Grande Cypress ALF",
      plantation_on_summers: "Plantation on Summers ALF",
      multiple: "Two or more facilities are scheduled on this one form",
      unknown: "No facility can be identified from the document",
    },
  },

  names_berkadia: {
    type: "noul",
    instructions:
      "Berkadia Commercial Mortgage LLC is named on this document as the mortgagee or loss payee",
    criteria: {
      true: "Berkadia Commercial Mortgage LLC appears by name in the mortgagee, loss payee, or additional interest wording",
      false:
        "A different lender is named, the mortgagee is described generically such as 'mortgagee as their interests may appear', or no mortgagee is named at all",
    },
  },

  names_hud_secretary: {
    type: "noul",
    instructions:
      "The Secretary of Housing and Urban Development is named on this document as a mortgagee or additional interest",
    criteria: {
      true: "Wording naming the Assistant Secretary for Housing, the Secretary of HUD, or the Department of Housing and Urban Development as an interested party appears alongside the lender",
      false:
        "Only a commercial lender is named, or HUD appears merely as a program reference, project number, or letterhead rather than as a named interest",
    },
  },

  isaoa_atima_present: {
    type: "noul",
    instructions:
      "The mortgagee or loss payee wording on this document carries ISAOA/ATIMA language",
    criteria: {
      true: "'Its successors and/or assigns' and/or 'as their interests may appear' — spelled out or abbreviated ISAOA, ATIMA — attaches to the named mortgagee",
      false: "The mortgagee is named with no successors-and-assigns language attached",
    },
  },

  epi_period: {
    type: "choice",
    instructions:
      "What extended period of indemnity does this document state — the period business income coverage continues after the property is restored and operations resume?",
    criteria: {
      at_least_180:
        "An extended period of indemnity of 180 days or more is stated explicitly, in days or in months",
      under_180: "An extended period of indemnity is stated explicitly and is shorter than 180 days",
      not_stated:
        "The document concerns business income or time element coverage but states no extended period of indemnity",
      not_applicable:
        "This document does not concern business income or time element coverage at all",
    },
  },

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
      false:
        "Either is missing, illegible, shown as TBD or pending, or only a broker, agency, or program name appears in place of the carrier",
    },
  },

  readiness: {
    type: "score",
    instructions: "How close is this document to being deliverable to the lender as it stands?",
    criteria: [
      "Required elements are missing; it cannot be sent in any form",
      "The elements are present but the wording is generic or does not meet the lender's requirements",
      "The wording is compliant but the document is awaiting signature, countersignature, or formal issuance",
      "Fully issued and compliant; it can go to the lender as it stands",
    ],
  },
};

/**
 * Measured against nine real Circle of Life documents on 2026-09-16 — the
 * 2026-27 Rising Oaks and Oakridge property certificates, their additional
 * remarks schedules, the Rising Oaks flood evidence, three liability and bond
 * certificates, and the 2022 Grande Cypress evidence of property insurance.
 *
 * The mortgagee bands are calibrated. The three HUD 232 parties read 78–99% on
 * documents that carry the wording and 2–15% on documents that do not; 0.65 and
 * 0.35 sit in an empty gap, not near a cluster. The 2022 Grande Cypress evidence
 * blocks with all three missing, which is the document this was built to catch.
 *
 * `sendReadyScore` is NOT calibrated and is currently unreachable: the best real
 * document scored 2.24, and readiness does not separate good from bad anyway —
 * the blocked Grande Cypress document scored 2.07, above two compliant ones.
 * The flags carry the discrimination; readiness only orders a queue. Whether an
 * unsigned ACORD 28 counts as deliverable is Brian's call, not a tuning job.
 */
export const COMPLIANCE_THRESHOLDS = {
  /** At or above this, a required mortgagee party is treated as present. */
  mortgageePartyPresent: 0.65,
  /**
   * Below this, it is treated as absent and the document is blocked. Between
   * the two is the uncertain band: Haven will not tell the agent their wording
   * is wrong on a coin flip, so it routes to a person instead.
   */
  mortgageePartyAbsent: 0.35,
  /** Below this, the document kind is not settled enough to gate on. */
  docTypeConfidence: 0.55,
  /** Below this, the facility cross-check result is not trustworthy. */
  facilityConfidence: 0.55,
  /** Above this, treat the document as a draft rather than an issued document. */
  isDraft: 0.7,
  /**
   * Below this, the carrier and policy number are treated as unresolved.
   *
   * Was 0.5, which a valid document nearly failed: the Oakridge property
   * certificate reads 0.51, one point above blocking itself, and the range
   * across good documents is 0.51–0.98. A wrongly blocked certificate sends an
   * agent chasing a defect that is not there. Still unsettled in the other
   * direction — no document with a genuinely missing carrier has been run, so
   * put the Grande Cypress VACP000948 case through before trusting this to
   * catch one.
   */
  carrierIdentified: 0.4,
  /** Readiness at or above this, with no flags, is send-ready. */
  sendReadyScore: 2.5,
} as const;

/**
 * Facility key → fragments that identify that facility in `facilities.name`.
 *
 * The question's criteria are hardcoded, so a facility Circle of Life adds
 * later is invisible to the model and cannot be cross-checked. Code detects
 * that case by failing to map the vault row's facility name here, rather than
 * letting a new building quietly read as `unknown`.
 */
export const FACILITY_NAME_FRAGMENTS: Record<string, readonly string[]> = {
  homewood_lodge: ["homewood"],
  oakridge: ["oakridge"],
  rising_oaks: ["rising oaks"],
  grande_cypress: ["grande cypress"],
  plantation_on_summers: ["plantation on summers"],
};

/** The facility key for a `facilities.name`, or null when it is not in the question set. */
export function facilityKeyForName(name: string | null | undefined): string | null {
  if (!name) return null;
  const haystack = name.toLowerCase();
  for (const [key, fragments] of Object.entries(FACILITY_NAME_FRAGMENTS)) {
    if (fragments.some((fragment) => haystack.includes(fragment))) return key;
  }
  return null;
}
