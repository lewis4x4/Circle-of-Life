/**
 * compliance-doc-check/handler — compose System One answers into one route.
 *
 * Pure function of (answers, the vault row's facility). No network, no
 * database, no clock, so the routing rules can be tested against fixed answers
 * and the tests say what Haven does with a document rather than what the model
 * said about it.
 *
 * Four routes, and the distinction between the first two is the whole point:
 *
 *   blocked        Haven is confident the document is defective. Actionable
 *                  without a human first: the flags name what to tell the agent.
 *   human_review   Haven is not confident. Never tell an agent their wording is
 *                  wrong on a coin flip.
 *   pending_carrier Compliant wording, not yet issued. Wait, do not re-ask.
 *   send_ready     Issued and compliant. It can go to the lender.
 */

import {
  requireChoice,
  requireNoul,
  requireScore,
  type SystemOneResponse,
} from "../_shared/typesafe-client.ts";
import {
  COMPLIANCE_THRESHOLDS as T,
  facilityKeyForName,
  QUESTIONS_VERSION,
} from "../_shared/compliance-doc-questions.ts";

export type ComplianceRoute = "blocked" | "human_review" | "pending_carrier" | "send_ready";

export type ComplianceFlag =
  /** Berkadia Commercial Mortgage LLC is not named as mortgagee. */
  | "HUD_232_BERKADIA_MISSING"
  /** HUD / the Assistant Secretary for Housing is not named alongside the lender. */
  | "HUD_232_HUD_SECRETARY_MISSING"
  /** The mortgagee is named without successors-and-assigns language. */
  | "HUD_232_ISAOA_ATIMA_MISSING"
  /** A stated extended period of indemnity is shorter than 180 days. */
  | "EPI_UNDER_180_DAYS"
  /** An EPI endorsement that never states its period. */
  | "EPI_PERIOD_NOT_STATED"
  /** No legible carrier and policy number. */
  | "CARRIER_UNRESOLVED"
  /** A draft, proof, or specimen — not an issued document. */
  | "DRAFT_NOT_ISSUED"
  /** The document names a different facility than the vault row it was filed under. */
  | "FACILITY_MISMATCH"
  /** Mortgagee wording landed in the uncertain band; a person must read it. */
  | "MORTGAGEE_WORDING_UNCERTAIN"
  /** Which facility the document covers could not be determined. */
  | "FACILITY_UNRESOLVED"
  /** The vault row's facility is not one the question can name — criteria are stale. */
  | "FACILITY_NOT_IN_QUESTION_SET"
  /** The document kind is not settled enough to gate the wording checks on. */
  | "DOC_TYPE_UNCERTAIN";

export type ComplianceTriage = {
  route: ComplianceRoute;
  /** Defects Haven is confident about. Drives `blocked`. */
  flags: ComplianceFlag[];
  /** Things Haven is not sure about. Drives `human_review`. Never sent to an agent. */
  uncertainties: ComplianceFlag[];
  doc_type: string;
  doc_type_confidence: number;
  facility_named: string;
  facility_confidence: number;
  /** null when the vault row's facility is not in the question set. */
  facility_matches: boolean | null;
  names_berkadia: number;
  names_hud_secretary: number;
  isaoa_atima_present: number;
  epi_period: string;
  is_draft: number;
  carrier_and_policy_identified: number;
  readiness: number;
  questions_version: string;
};

/** Document kinds whose job is to carry mortgagee wording. */
const MORTGAGEE_BEARING = new Set(["evidence_of_property_insurance", "mortgagee_endorsement"]);

type PartyVerdict = "present" | "absent" | "uncertain";

function partyVerdict(probability: number): PartyVerdict {
  if (probability >= T.mortgageePartyPresent) return "present";
  if (probability < T.mortgageePartyAbsent) return "absent";
  return "uncertain";
}

export function triageDocument(
  response: SystemOneResponse,
  vaultFacilityName: string | null,
): ComplianceTriage {
  const docType = requireChoice(response, "doc_type");
  const facility = requireChoice(response, "facility_named");
  const epi = requireChoice(response, "epi_period");
  const berkadia = requireNoul(response, "names_berkadia");
  const hud = requireNoul(response, "names_hud_secretary");
  const isaoa = requireNoul(response, "isaoa_atima_present");
  const isDraft = requireNoul(response, "is_draft");
  const carrier = requireNoul(response, "carrier_and_policy_identified");
  const readiness = requireScore(response, "readiness");

  const flags: ComplianceFlag[] = [];
  const uncertainties: ComplianceFlag[] = [];

  const docTypeSettled = docType.confidence >= T.docTypeConfidence;
  if (!docTypeSettled) uncertainties.push("DOC_TYPE_UNCERTAIN");

  // Mortgagee wording is checked on evidence of property insurance too, not just
  // on endorsements. Generic wording slipping through on an ACORD 28 is the
  // failure mode this function exists to catch; gating the check on the document
  // calling itself an endorsement would skip exactly that case. An unsettled
  // document kind is also checked, on the same reasoning.
  if (MORTGAGEE_BEARING.has(docType.choice) || !docTypeSettled) {
    const parties: Array<[PartyVerdict, ComplianceFlag]> = [
      [partyVerdict(berkadia), "HUD_232_BERKADIA_MISSING"],
      [partyVerdict(hud), "HUD_232_HUD_SECRETARY_MISSING"],
      [partyVerdict(isaoa), "HUD_232_ISAOA_ATIMA_MISSING"],
    ];
    for (const [verdict, flag] of parties) {
      if (verdict === "absent") flags.push(flag);
    }
    if (parties.some(([verdict]) => verdict === "uncertain")) {
      uncertainties.push("MORTGAGEE_WORDING_UNCERTAIN");
    }
  }

  // A stated shortfall is a defect on any document that states it. A missing
  // period is only a defect on the endorsement whose job is to state one.
  if (epi.choice === "under_180") flags.push("EPI_UNDER_180_DAYS");
  if (epi.choice === "not_stated" && docType.choice === "epi_endorsement") {
    flags.push("EPI_PERIOD_NOT_STATED");
  }

  if (carrier < T.carrierIdentified) flags.push("CARRIER_UNRESOLVED");
  if (isDraft > T.isDraft) flags.push("DRAFT_NOT_ISSUED");

  // The vault row is authoritative for which facility this document belongs to;
  // the model's answer is a cross-check on whether the right file was uploaded.
  const vaultKey = facilityKeyForName(vaultFacilityName);
  let facilityMatches: boolean | null = null;
  if (vaultFacilityName && vaultKey === null) {
    uncertainties.push("FACILITY_NOT_IN_QUESTION_SET");
  } else if (vaultKey !== null) {
    if (facility.choice === "unknown" || facility.confidence < T.facilityConfidence) {
      uncertainties.push("FACILITY_UNRESOLVED");
    } else if (facility.choice === "multiple") {
      // A schedule covering several buildings legitimately includes this one.
      facilityMatches = true;
    } else {
      facilityMatches = facility.choice === vaultKey;
      if (!facilityMatches) flags.push("FACILITY_MISMATCH");
    }
  }

  // A confirmed defect outranks uncertainty: the wording has to be fixed
  // whichever building it belongs to, and `blocked` is the actionable answer.
  // FACILITY_MISMATCH is the exception — it is a filing question for a person,
  // not something to send back to the agent — so it routes to human_review.
  const defects = flags.filter((flag) => flag !== "FACILITY_MISMATCH");
  const route: ComplianceRoute = defects.length > 0
    ? "blocked"
    : flags.includes("FACILITY_MISMATCH") || uncertainties.length > 0
    ? "human_review"
    : readiness.score >= T.sendReadyScore
    ? "send_ready"
    : "pending_carrier";

  return {
    route,
    flags,
    uncertainties,
    doc_type: docType.choice,
    doc_type_confidence: docType.confidence,
    facility_named: facility.choice,
    facility_confidence: facility.confidence,
    facility_matches: facilityMatches,
    names_berkadia: berkadia,
    names_hud_secretary: hud,
    isaoa_atima_present: isaoa,
    epi_period: epi.choice,
    is_draft: isDraft,
    carrier_and_policy_identified: carrier,
    readiness: readiness.score,
    questions_version: QUESTIONS_VERSION,
  };
}
