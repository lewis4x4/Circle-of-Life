import { scoreFacility } from "./scoring.js";
import { evaluateGate0, evaluateGate2 } from "./gates.js";
import { onboardingIntakeCatalog } from "./intakeCatalog.js";

function line(text = "") {
  return `${text}\n`;
}

function recentDecisionLog(state, count = 6) {
  return (state.decisionLog || []).slice(0, count);
}

function sourceOfTruthDecisions(state) {
  return (state.documentGroups || []).map((group) => {
    const selected = (state.documents || []).find((doc) => doc.id === group.sourceOfTruthDocumentId);
    return { group, selected };
  });
}

function signedGates(state) {
  return (state.gates || []).filter((gate) => gate.status === "signed" || gate.signedAt);
}

function operationalIntakeSnapshot(state) {
  return Object.entries(onboardingIntakeCatalog).map(([code, spec]) => {
    const module = (state.modules || []).find((m) => m.moduleCode === code) || {};
    const metric = scoreFacility(state).moduleMetrics.find((m) => m.moduleCode === code) || {};
    const data = state.mvpData?.[code] || {};
    return {
      code,
      name: module.moduleName || code,
      completenessPct: metric.completenessPct ?? 0,
      purpose: spec.purpose,
      requiredChecklist: spec.checklist || [],
      scalarFields: (spec.fields || []).map((field) => ({ key: field.key, label: field.label, present: Boolean(String(data[field.key] ?? "").trim()) })),
      collections: (spec.collections || []).map((collection) => ({
        key: collection.key,
        label: collection.label,
        recordCount: Array.isArray(data[collection.key]) ? data[collection.key].length : 0,
        requiredFields: collection.requiredFields || []
      }))
    };
  });
}

export function buildLaunchNarrative(state) {
  const score = scoreFacility(state);
  const g0 = evaluateGate0(state);
  const g2 = evaluateGate2(state);
  const staleCount = (state.documents || []).filter((doc) => doc.currencyStatus === "stale").length;
  const unresolvedDuplicates = score.unresolvedDuplicateGroups.length;
  const openContradictions = (state.contradictions || []).filter((c) => c.status === "open");
  const signed = signedGates(state).map((gate) => gate.code).join(", ") || "none yet";

  return [
    `Homewood is being converted from scattered onboarding evidence into a verified Facility DNA operating model.`,
    `Readiness is ${score.facilityReadinessScore}/100 with Gate 0 ${g0.pass ? "ready" : "blocked"} and Gate 2 ${g2.pass ? "ready" : "blocked"}; signed gates: ${signed}.`,
    `The visible complexity is dual legal entities (${state.mvpData?.M1?.operatingLlc || "operating LLC TBD"} vs ${state.mvpData?.M1?.propertyLlc || "property LLC TBD"}), ${staleCount} stale document(s), ${unresolvedDuplicates} unresolved duplicate group(s), and ${openContradictions.length} open contradiction(s).`,
    `Next action: ${g2.blockers[0] || "export signed readiness packet and move to launch preparation."}`
  ].join(" ");
}

export function buildReadinessMarkdown(state) {
  const score = scoreFacility(state);
  const g0 = evaluateGate0(state);
  const g2 = evaluateGate2(state);
  const approvedExceptions = (state.exceptions || []).filter((e) => e.status === "approved");
  const openContradictions = (state.contradictions || []).filter((c) => c.status === "open");

  let out = "";
  out += line("# Facility Launch Readiness Summary");
  out += line(`- Program: ${state.program?.name || ""}`);
  out += line(`- Facility: ${state.facility?.name || ""}`);
  out += line(`- Facility Score: ${score.facilityReadinessScore}`);
  out += line(`- Gate 0: ${g0.pass ? "PASS" : "BLOCKED"}`);
  out += line(`- Gate 2: ${g2.pass ? "PASS" : "BLOCKED"}`);
  out += line();

  out += line("## Launch Narrative / Executive Summary");
  out += line(buildLaunchNarrative(state));
  out += line();

  out += line("## Signed Gate Records");
  const gates = signedGates(state);
  if (!gates.length) out += line("- None signed yet");
  gates.forEach((gate) => {
    out += line(`- ${gate.code} ${gate.name}: signed by ${gate.signedBy || ""} (${gate.signedRole || gate.requiredSignerRole || "role not recorded"}) at ${gate.signedAt || ""}`);
    out += line(`  - Criteria snapshot: ${(gate.criteriaSnapshot?.criteria || []).filter((c) => c.pass).length}/${(gate.criteriaSnapshot?.criteria || []).length} pass; blockers=${(gate.criteriaSnapshot?.blockers || []).length}`);
    out += line(`  - Exceptions relied upon: ${(gate.criteriaSnapshot?.exceptionsReliedUpon || []).map((e) => e.id).join(", ") || "none"}`);
  });
  out += line();

  out += line("## Current Criteria Snapshot Summary");
  [g0, g2].forEach((gate) => {
    out += line(`- ${gate.gate}: ${gate.criteria.filter((c) => c.pass).length}/${gate.criteria.length} pass; required signer=${gate.requiredSignerRole}`);
    gate.criteria.filter((c) => !c.pass).forEach((criterion) => out += line(`  - BLOCKED: ${criterion.blocker}`));
  });
  out += line();

  out += line("## Readiness Map Snapshot");
  score.moduleMetrics.forEach((m) => {
    out += line(`- ${m.moduleCode} ${m.moduleName}: score=${m.score ?? "N/A"}, completeness=${m.completenessPct ?? "N/A"}%, owner=${m.ownerName}, scope=${m.scopeStatus}, status=${m.status}, evidence=${m.evidenceCount}, stale=${m.staleCount}, contradictions=${m.contradictionCount}, exceptions=${m.exceptionCount}, next=${m.nextAction}`);
  });
  out += line();
  out += line("## Complete Onboarding Intake Coverage");
  operationalIntakeSnapshot(state).forEach((module) => {
    out += line(`- ${module.code} ${module.name}: completeness=${module.completenessPct}%`);
    module.collections.forEach((collection) => {
      out += line(`  - ${collection.label}: ${collection.recordCount} record(s); required=${collection.requiredFields.join(", ")}`);
    });
  });
  out += line();

  out += line("## Owner Worksheet Coverage");
  (state.modules || []).forEach((m) => {
    out += line(`- ${m.moduleCode} ${m.moduleName}: owner=${m.ownerName || "missing"}, source=${m.source || "missing"}, due=${m.dueDate || "missing"}, scope=${m.scopeStatus}, status=${m.status}, next=${m.nextAction || ""}`);
  });
  out += line();

  out += line("## Source-of-Truth Decisions");
  sourceOfTruthDecisions(state).forEach(({ group, selected }) => {
    out += line(`- ${group.name}: ${selected ? `${selected.title} (${selected.artifactType}, ${selected.currencyStatus}, approval=${selected.custodianApprovalStatus})` : "unresolved"}`);
  });
  out += line();

  out += line("## Exceptions Relied Upon");
  if (!approvedExceptions.length) out += line("- None");
  approvedExceptions.forEach((e) => {
    out += line(`- ${e.id}: ${e.scopeType}:${e.scopeId} — ${e.description} | approver=${e.approverName || ""} (${e.approverRole || ""}) at ${e.approvedAt || ""}`);
  });
  out += line();

  out += line("## Contradiction Summary");
  if (!openContradictions.length) out += line("- No open contradictions");
  openContradictions.forEach((c) => {
    out += line(`- ${c.id}: ${c.summary} | owner=${c.ownerName || "unassigned"} | decisionOwner=${c.decisionOwner || ""}`);
    if (c.type === "policy_reality_app") out += line(`  - Policy=${c.policyValue || ""}; Reality=${c.realityValue || ""}; App Setting=${c.appSettingValue || ""}`);
    if (c.resolutionNotes) out += line(`  - Resolution notes=${c.resolutionNotes}`);
  });
  out += line();

  out += line("## Recent Decision Log Excerpts");
  recentDecisionLog(state).forEach((entry) => {
    out += line(`- ${entry.timestamp} — ${entry.actionType}: ${entry.summary}`);
  });

  return out;
}

export function buildStateJsonExport(state) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      launchNarrative: buildLaunchNarrative(state),
      program: state.program,
      facility: state.facility,
      gates: state.gates,
      signedGates: signedGates(state),
      sourceOfTruthDecisions: sourceOfTruthDecisions(state),
      readiness: {
        score: scoreFacility(state),
        gate0: evaluateGate0(state),
        gate2: evaluateGate2(state)
      },
      modules: state.modules,
      mvpData: state.mvpData,
      completeOnboardingIntake: operationalIntakeSnapshot(state),
      documents: state.documents,
      documentGroups: state.documentGroups,
      exceptions: state.exceptions,
      contradictions: state.contradictions,
      decisionLog: state.decisionLog
    },
    null,
    2
  );
}
