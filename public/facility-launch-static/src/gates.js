import {
  scoreFacility,
  getModulesMissingCoverage,
  getUnresolvedDuplicateGroups,
  getInvalidSourceOfTruthGroups,
  hasApprovedException,
  hasApprovedModuleException
} from "./scoring.js";

function pass(label) {
  return { label, pass: true, severity: "info", blocker: "" };
}

function fail(label, blocker, severity = "blocking") {
  return { label, pass: false, severity, blocker };
}

function getStaleDocsNeedingAction(state) {
  return (state?.documents || []).filter((doc) => {
    if (doc.currencyStatus !== "stale") return false;
    const routed = Boolean(String(doc.routedOwnerName || "").trim());
    const approvedException = hasApprovedException(state, "document", doc.id);
    return !routed && !approvedException;
  });
}

export function evaluateGate0(state) {
  const p = state?.program || {};
  const criteria = [];

  criteria.push(p.name ? pass("Program exists") : fail("Program exists", "Create program charter."));
  criteria.push(p.sponsor ? pass("Sponsor named") : fail("Sponsor named", "Assign executive sponsor."));
  criteria.push(p.deputySponsor ? pass("Deputy sponsor named") : fail("Deputy sponsor named", "Assign deputy sponsor."));
  criteria.push(p.cfo ? pass("CFO named") : fail("CFO named", "Assign CFO."));
  criteria.push(p.coo ? pass("COO named") : fail("COO named", "Assign COO."));
  criteria.push(p.onboarder ? pass("Onboarder named") : fail("Onboarder named", "Assign onboarder."));
  criteria.push(p.documentCustodian ? pass("Document custodian named") : fail("Document custodian named", "Assign document custodian."));
  criteria.push(state?.facility?.status === "pilot" ? pass("Homewood in pilot scope") : fail("Homewood in pilot scope", "Set Homewood status to pilot/in-scope."));
  criteria.push(p.homewoodScope ? pass("Homewood scope recorded") : fail("Homewood scope recorded", "Record Homewood pilot scope."));
  criteria.push(p.definitionOfLive ? pass("Definition of Live recorded") : fail("Definition of Live recorded", "Record Definition of Live."));
  criteria.push(p.thresholds?.moduleReadinessTarget ? pass("Thresholds defined") : fail("Thresholds defined", "Set readiness thresholds."));

  const blockers = criteria.filter((c) => !c.pass).map((c) => c.blocker);
  return {
    gate: "G0",
    pass: blockers.length === 0,
    criteria,
    blockers,
    requiredSignerRole: "Executive Sponsor"
  };
}

export function evaluateGate2(state) {
  const scoring = scoreFacility(state);
  const missingCoverageModules = getModulesMissingCoverage(state?.modules || [], state);
  const unresolvedDuplicates = getUnresolvedDuplicateGroups(state);
  const invalidSotGroups = getInvalidSourceOfTruthGroups(state);
  const staleNeedingAction = getStaleDocsNeedingAction(state);
  const ownerlessOpenContradictions = (state?.contradictions || []).filter(
    (c) => c.status === "open" && !String(c.ownerName || "").trim()
  );

  const mvpCompletenessFailures = scoring.moduleScores.filter((m) => {
    if (!m.isMvpDetailed || typeof m.completenessPct !== "number" || m.completenessPct >= 95) return false;
    const module = (state?.modules || []).find((candidate) => candidate.moduleCode === m.moduleCode);
    return !hasApprovedModuleException(state, module);
  });

  const criteria = [];
  criteria.push(
    missingCoverageModules.length === 0
      ? pass("All modules have owner/source/due or approved exception")
      : fail(
          "All modules have owner/source/due or approved exception",
          `Missing owner/source/due coverage on modules: ${missingCoverageModules.map((m) => m.moduleCode).join(", ")}`
        )
  );

  criteria.push(
    mvpCompletenessFailures.length === 0
      ? pass("Complete onboarding modules >=95% data completeness or approved exception")
      : fail(
          "Complete onboarding modules >=95% data completeness or approved exception",
          `Onboarding data completeness below 95%: ${mvpCompletenessFailures.map((m) => `${m.moduleCode}(${m.completenessPct}%)`).join(", ")}`
        )
  );

  criteria.push(
    unresolvedDuplicates.length === 0
      ? pass("No unresolved duplicate source-of-truth groups")
      : fail(
          "No unresolved duplicate source-of-truth groups",
          `Unresolved duplicate groups: ${unresolvedDuplicates.map((g) => g.name).join(", ")}`
        )
  );

  criteria.push(
    invalidSotGroups.length === 0
      ? pass("No invalid source-of-truth selections")
      : fail(
          "No invalid source-of-truth selections",
          `Invalid source-of-truth groups: ${invalidSotGroups.map((g) => g.name).join(", ")}`
        )
  );

  criteria.push(
    staleNeedingAction.length === 0
      ? pass("Stale documents are owner-routed or exception-approved")
      : fail(
          "Stale documents are owner-routed or exception-approved",
          `Stale docs need route/approval: ${staleNeedingAction.map((d) => d.title).join(", ")}`,
          "major"
        )
  );

  criteria.push(
    ownerlessOpenContradictions.length === 0
      ? pass("Open contradictions have named owners")
      : fail(
          "Open contradictions have named owners",
          `Ownerless contradictions: ${ownerlessOpenContradictions.map((c) => c.id).join(", ")}`
        )
  );

  const scoreTarget = Number(state?.program?.thresholds?.gate2FacilityScoreTarget || 90);
  criteria.push(
    scoring.facilityReadinessScore >= scoreTarget
      ? pass("Facility readiness meets Gate 2 threshold")
      : fail(
          "Facility readiness meets Gate 2 threshold",
          `Facility readiness ${scoring.facilityReadinessScore} is below Gate 2 target ${scoreTarget}`
        )
  );

  const blockers = criteria.filter((c) => !c.pass).map((c) => c.blocker);

  return {
    gate: "G2",
    pass: blockers.length === 0,
    criteria,
    blockers,
    facilityReadinessScore: scoring.facilityReadinessScore,
    requiredSignerRole: "Executive Sponsor / COO"
  };
}
