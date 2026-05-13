import {
  loadState,
  saveState,
  resetState,
  appendDecisionLog,
  updateProgramField,
  updateProgramThreshold,
  updateOwnerWorksheetRow,
  updateMvpDataField,
  addM3Room,
  addM4Employee,
  addModuleRecord,
  updateModuleRecord,
  deleteModuleRecord,
  addDocument,
  deleteDocument,
  updateDocument,
  selectSourceOfTruthDocument,
  routeStaleDocument,
  addException,
  approveException,
  closeException,
  addContradiction,
  updateContradiction,
  assignContradictionOwner,
  resolveContradiction,
  signGate
} from "./state.js";
import { scoreFacility } from "./scoring.js";
import { evaluateGate0, evaluateGate2 } from "./gates.js";
import { buildReadinessMarkdown, buildStateJsonExport, buildLaunchNarrative } from "./export.js";
import { onboardingIntakeCatalog } from "./intakeCatalog.js";
import { inferDocumentIntelligence } from "./documentIntelligence.js";
import { loadPipelineConfig, savePipelineConfig, pipelineConfigured, uploadDocumentToSupabasePipeline, pushStateToHaven } from "./supabasePipeline.js";

let state = loadState();
let activeTab = "overview";
let lastDocumentSaveSummary = "";
let pipelineMessage = "";
let pushResult = null;       // last response from pushStateToHaven (success)
let pushError = "";          // last error message from pushStateToHaven (failure)
let pushBusy = false;        // true while a push is in flight
let pushDryRun = true;       // toggled by the "Preview only" checkbox

const tabsEl = document.getElementById("tabs");
const summaryEl = document.getElementById("summary");
const viewEl = document.getElementById("view");
const decisionLogEl = document.getElementById("decision-log");
const resetButton = document.getElementById("reset-demo");
const loadRound1Button = document.getElementById("load-round1-state");
const ROUND1_STATE_URL = new URL("../data/homewood-round1-state.json", import.meta.url);

const MODULE_STATUSES = ["not_started", "assigned", "in_progress", "ready_for_review", "signed", "blocked"];
const SCOPE_STATUSES = ["in", "out", "tbd"];
const ARTIFACT_TYPES = ["state_license", "gl_cert", "property_insurance", "property_policy", "bond_certificate", "loss_run", "floor_plan", "emergency_plan", "vendor_agreement", "compilation_file", "other"];
const CURRENCY_STATUSES = ["fresh", "aging", "stale", "unknown"];
const APPROVAL_STATUSES = ["pending", "approved", "rejected", "needs_review"];
const CONFIDENCE_LEVELS = ["low", "medium", "high", "manual"];

const tabs = [
  ["overview", "Facility Command Center"],
  ["program", "Program Charter"],
  ["worksheet", "Module Owners & Due Dates"],
  ["readiness", "Readiness Map"],
  ["modules", "Onboarding Intake"],
  ["docs", "Document Intake"],
  ["exceptions", "Exceptions"],
  ["contradictions", "Policy vs Reality Checks"],
  ["gates", "Gate Checks"],
  ["export", "Export"]
];

function esc(v) {
  return String(v ?? "").replace(/[&<>"]/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[m]));
}

function option(value, selected) {
  return `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`;
}

function currencyBadge(status) {
  return `<span class="badge badge-${esc(status || "na")}">${esc(status || "n/a")}</span>`;
}

function statusBadge(status) {
  const normalized = String(status || "unknown").replaceAll("_", "-");
  return `<span class="badge badge-${esc(normalized)}">${esc(status || "unknown")}</span>`;
}

function field(label, html, hint = "") {
  return `<label class="field"><span>${esc(label)}</span>${html}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
}

function input(attrs) {
  const { label, value = "", hint = "", ...rest } = attrs;
  const attr = Object.entries(rest).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return field(label, `<input ${attr} value="${esc(value)}" />`, hint);
}

function textarea(attrs) {
  const { label, value = "", hint = "", ...rest } = attrs;
  const attr = Object.entries(rest).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return field(label, `<textarea ${attr}>${esc(value)}</textarea>`, hint);
}

function getGateStatusLabel(g) {
  const signed = (state.gates || []).find((x) => x.code === g.gate)?.signedAt;
  if (signed) return "SIGNED";
  return g.pass ? "READY" : "BLOCKED";
}

function renderTabs() {
  tabsEl.innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="tab ${activeTab === id ? "active" : ""}">${label}</button>`).join("");
}

function renderSummary() {
  const score = scoreFacility(state);
  const g0 = evaluateGate0(state);
  const g2 = evaluateGate2(state);
  const staleCount = (state.documents || []).filter((d) => d.currencyStatus === "stale").length;
  const openContradictions = (state.contradictions || []).filter((c) => c.status === "open").length;
  summaryEl.innerHTML = `
    <div class="command-hero">
      <div>
        <p class="eyebrow">Facility DNA Launch Command</p>
        <h2>${esc(state.facility.name)}</h2>
        <p>${esc(buildLaunchNarrative(state))}</p>
      </div>
      <div class="hero-score"><span>${score.facilityReadinessScore}</span><small>readiness</small></div>
    </div>
    <div class="cards kpis">
      <div class="card"><h4>Gate 0</h4><p>${getGateStatusLabel(g0)}</p><small>${g0.criteria.filter((c) => c.pass).length}/${g0.criteria.length} criteria pass</small></div>
      <div class="card"><h4>Gate 2</h4><p>${getGateStatusLabel(g2)}</p><small>${g2.blockers.length} blocker(s)</small></div>
      <div class="card"><h4>Documents</h4><p>${state.documents.length}</p><small>${staleCount} stale · ${score.unresolvedDuplicateGroups.length} duplicate group(s) unresolved</small></div>
      <div class="card"><h4>Contradictions</h4><p>${openContradictions}</p><small>Policy vs Reality vs App visible</small></div>
      <div class="card"><h4>Import Reviews</h4><p>${(state.ingestionReviewQueue || []).length}</p><small>Round 1 records needing review</small></div>
      <div class="card"><h4>Import Gaps</h4><p>${(state.ingestionGaps || []).length}</p><small>Second-pass source queue</small></div>
    </div>
  `;
}

function renderIngestionQueues() {
  const gaps = state.ingestionGaps || [];
  const reviews = state.ingestionReviewQueue || [];
  const manifest = state.ingestionManifest || null;
  if (!manifest && !gaps.length && !reviews.length) return "";
  const gapRows = gaps.length
    ? gaps.map((gap) => `<tr><td>${esc(gap.moduleCode)}</td><td>${esc(gap.sourceId)}</td><td>${esc(gap.fieldOrRecord)}</td><td>${esc(gap.reason)}</td></tr>`).join("")
    : `<tr><td colspan="4">No Round 1/2 gap records loaded.</td></tr>`;
  const reviewRows = reviews.length
    ? reviews.slice(0, 12).map((item) => `<tr><td>${esc((item.moduleCodes || []).join(", "))}</td><td>${esc(item.sourceId)}</td><td>${esc(item.targetEntity)}</td><td>${esc(item.reason)}</td></tr>`).join("")
    : `<tr><td colspan="4">No review queue records loaded.</td></tr>`;
  return `
    <div class="panel-ish span2">
      <div class="row-between">
        <div>
          <p class="eyebrow">Round 1 Real Import</p>
          <h3>${manifest ? "Homewood Round 1 state loaded" : "No generated import loaded"}</h3>
        </div>
        <div class="mini-kpis">
          <span class="badge badge-info">${esc(manifest?.artifactCount || 0)}/${esc(manifest?.sourceCount || 0)} sources</span>
          <span class="badge badge-watch">${reviews.length} review</span>
          <span class="badge badge-blocked">${gaps.length} gaps</span>
        </div>
      </div>
      <p>${esc(manifest?.roundPolicy || "Click Load Round 1 Import to hydrate the app from normalized artifacts.")}</p>
      <div class="grid2">
        <div>
          <h4>Second-pass gap queue</h4>
          <div class="table-wrap compact-table"><table><thead><tr><th>Module</th><th>Source</th><th>Field/source</th><th>Reason</th></tr></thead><tbody>${gapRows}</tbody></table></div>
        </div>
        <div>
          <h4>Needs-review queue</h4>
          <div class="table-wrap compact-table"><table><thead><tr><th>Module</th><th>Source</th><th>Target</th><th>Reason</th></tr></thead><tbody>${reviewRows}</tbody></table></div>
          ${reviews.length > 12 ? `<small>Showing first 12 of ${reviews.length} review records.</small>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderOverview() {
  const score = scoreFacility(state);
  const g2 = evaluateGate2(state);
  const sotResolved = (state.documentGroups || []).filter((g) => g.sourceOfTruthDocumentId).length;
  return `
    <section class="command-grid">
      <div class="panel-ish span2">
        <p class="eyebrow">North Star</p>
        <h2>Learn the facility. Verify the operating model. Launch with accountable owners.</h2>
        <p class="lead">This Facility Launch Center turns Homewood's scattered legal/entity, staffing, room, document, and policy evidence into a Facility DNA record that executives can sign.</p>
      </div>
      <div class="panel-ish">
        <h3>What is ready</h3>
        <ul class="clean-list">
          <li>Program container and Gate 0 authority are modeled.</li>
          <li>${sotResolved}/${state.documentGroups.length} document groups have source-of-truth decisions.</li>
          <li>${score.moduleMetrics.filter((m) => m.score >= 95).length}/19 module cards are launch-ready or exception-backed.</li>
        </ul>
      </div>
      <div class="panel-ish danger-soft">
        <h3>What is blocked</h3>
        <ul>${(g2.blockers.length ? g2.blockers : ["No Gate 2 blockers"]).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>
      ${renderIngestionQueues()}
      <div class="panel-ish">
        <h3>Homewood complexity surfaced</h3>
        <div class="complexity-list">
          <div><strong>Dual entities</strong><span>${esc(state.mvpData.M1.operatingLlc || "Operating LLC TBD")} / ${esc(state.mvpData.M1.propertyLlc || "Property LLC TBD")}</span></div>
          <div><strong>Stale docs</strong><span>${(state.documents || []).filter((d) => d.currencyStatus === "stale").length} evidence rows need routing or exception.</span></div>
          <div><strong>Duplicate docs</strong><span>${score.unresolvedDuplicateGroups.map((g) => g.name).join(", ") || "Resolved"}</span></div>
          <div><strong>Rounds reality</strong><span>Policy vs interview reality vs app setting contradiction is tracked and owned.</span></div>
          <div><strong>Claims awareness</strong><span>Loss run evidence routes to CFO/Legal awareness before launch.</span></div>
        </div>
      </div>
      <div class="panel-ish">
        <h3>What changed recently</h3>
        <ul>${(state.decisionLog || []).slice(0, 6).map((d) => `<li><strong>${esc(d.actionType)}</strong><br><span>${esc(d.summary)}</span></li>`).join("")}</ul>
      </div>
    </section>
  `;
}

function renderProgram() {
  const p = state.program || {};
  const t = p.thresholds || {};
  const g0 = evaluateGate0(state);
  return `
    <h2>Program Setup / Charter</h2>
    <p class="lead">Gate 0 updates live from this charter. Capture who can authorize launch work, what Homewood includes, and what “Live” means.</p>
    <div class="grid2">
      ${input({ label: "Program name", "data-program": "name", value: p.name })}
      ${input({ label: "Executive sponsor", "data-program": "sponsor", value: p.sponsor })}
      ${input({ label: "Deputy sponsor", "data-program": "deputySponsor", value: p.deputySponsor })}
      ${input({ label: "CFO", "data-program": "cfo", value: p.cfo })}
      ${input({ label: "COO", "data-program": "coo", value: p.coo })}
      ${input({ label: "Onboarder", "data-program": "onboarder", value: p.onboarder })}
      ${input({ label: "Document custodian", "data-program": "documentCustodian", value: p.documentCustodian })}
      ${input({ label: "MVP readiness target", type: "number", "data-threshold": "moduleReadinessTarget", value: t.moduleReadinessTarget })}
      ${input({ label: "Stale document months", type: "number", "data-threshold": "staleMonths", value: t.staleMonths })}
      ${input({ label: "Gate 2 facility score target", type: "number", "data-threshold": "gate2FacilityScoreTarget", value: t.gate2FacilityScoreTarget })}
      ${textarea({ label: "Definition of Live", "data-program": "definitionOfLive", value: p.definitionOfLive })}
      ${textarea({ label: "Homewood scope", "data-program": "homewoodScope", value: p.homewoodScope })}
    </div>
    <h3>Gate 0 checklist</h3>
    <ul class="criteria-list">${g0.criteria.map((c) => `<li class="${c.pass ? "ok" : "fail"}"><strong>${c.pass ? "PASS" : "BLOCK"}</strong> ${esc(c.label)}${c.blocker ? `<small>${esc(c.blocker)}</small>` : ""}</li>`).join("")}</ul>
  `;
}

function renderWorksheet() {
  const rows = (state.modules || []).map((m) => `
    <tr>
      <td><strong>${esc(m.moduleCode)}</strong><br><span>${esc(m.moduleName)}</span></td>
      <td><input data-ws="ownerName" data-code="${m.moduleCode}" value="${esc(m.ownerName)}" placeholder="One accountable owner" /></td>
      <td><input data-ws="ownerTitle" data-code="${m.moduleCode}" value="${esc(m.ownerTitle)}" placeholder="Title" /></td>
      <td><input data-ws="source" data-code="${m.moduleCode}" value="${esc(m.source)}" placeholder="System, binder, person" /></td>
      <td><input type="date" data-ws="dueDate" data-code="${m.moduleCode}" value="${esc(m.dueDate)}" /></td>
      <td><select data-ws="scopeStatus" data-code="${m.moduleCode}">${SCOPE_STATUSES.map((s) => option(s, m.scopeStatus)).join("")}</select></td>
      <td><select data-ws="status" data-code="${m.moduleCode}">${MODULE_STATUSES.map((s) => option(s, m.status)).join("")}</select></td>
      <td><input data-ws="nextAction" data-code="${m.moduleCode}" value="${esc(m.nextAction || "")}" placeholder="Next action" /></td>
      <td><textarea data-ws="openQuestions" data-code="${m.moduleCode}" placeholder="Open questions">${esc(m.openQuestions)}</textarea></td>
    </tr>
  `).join("");
  return `<h2>Launch Accountability Matrix (19 modules)</h2><p class="lead"><strong>This is not the resident/rate intake screen.</strong> This table assigns the accountable human, source of truth, due date, and next action for each onboarding module. Actual resident, rate, rounds, care, staffing, vendor, and KPI data is entered in <strong>Complete Intake / Facility DNA</strong>.</p><div class="table-wrap"><table><thead><tr><th>Module</th><th>Data Owner</th><th>Owner Title</th><th>Source of Truth</th><th>Due</th><th>Scope</th><th>Status</th><th>Next Action</th><th>Open Questions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderReadiness() {
  const score = scoreFacility(state);
  const g2 = evaluateGate2(state);
  return `
    <h2>Facility Readiness Map</h2>
    <p class="lead">Hero map of Facility DNA readiness: what is known, what is stale, who owns the next move, and what blocks launch.</p>
    <div class="readiness-grid">${score.moduleMetrics.map((m) => `<button class="readiness-card ${m.score >= 95 ? "ready" : m.score >= 70 ? "watch" : "blocked"}" data-tab="modules">
      <div class="row-between"><h4>${esc(m.moduleCode)} ${esc(m.moduleName)}</h4>${statusBadge(m.status)}</div>
      <div class="score-line"><span>${m.score ?? "N/A"}</span><small>${m.completenessPct ?? "N/A"}% complete</small></div>
      <dl>
        <div><dt>Owner</dt><dd>${esc(m.ownerName)}</dd></div>
        <div><dt>Scope</dt><dd>${esc(m.scopeStatus)}</dd></div>
        <div><dt>Evidence</dt><dd>${m.evidenceCount}</dd></div>
        <div><dt>Stale</dt><dd>${m.staleCount}</dd></div>
        <div><dt>Contradictions</dt><dd>${m.contradictionCount}</dd></div>
        <div><dt>Exceptions</dt><dd>${m.exceptionCount}</dd></div>
      </dl>
      <p><strong>Next:</strong> ${esc(m.nextAction)}</p>
    </button>`).join("")}</div>
    <h3>Gate 2 blockers</h3>
    <ul>${(g2.blockers.length ? g2.blockers : ["No blockers — Gate 2 can be signed."]).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
  `;
}

function fieldHelp(fieldDef) {
  return fieldDef.help || fieldDef.hint || (fieldDef.sampleValue ? `Example: ${fieldDef.sampleValue}` : "");
}

function fieldPlaceholder(fieldDef) {
  return fieldDef.placeholder || fieldDef.sampleValue || fieldDef.label || "";
}

function normalizeOption(optionItem) {
  if (typeof optionItem === "object" && optionItem !== null) {
    return { value: String(optionItem.value ?? optionItem.label ?? ""), label: String(optionItem.label ?? optionItem.value ?? "") };
  }
  return { value: String(optionItem ?? ""), label: String(optionItem ?? "") };
}

function renderOptions(options = [], selected = "") {
  const normalizedOptions = options.map(normalizeOption);
  const hasSelected = !selected || normalizedOptions.some((optionItem) => optionItem.value === selected);
  const selectedOption = hasSelected ? "" : `<option value="${esc(selected)}" selected>${esc(selected)} (existing)</option>`;
  return `${selectedOption}${normalizedOptions.map((optionItem) => `<option value="${esc(optionItem.value)}" ${optionItem.value === selected ? "selected" : ""}>${esc(optionItem.label)}</option>`).join("")}`;
}

function renderIntakeFieldControl(fieldDef, attrs = {}, value = "") {
  const normalizedAttrs = Object.fromEntries(Object.entries(attrs).filter(([, attrValue]) => attrValue !== "" && attrValue !== false && attrValue !== null && attrValue !== undefined));
  const attr = Object.entries(normalizedAttrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  const type = fieldDef.control || fieldDef.type || "text";
  if (fieldDef.relation) {
    const options = relationOptions(fieldDef);
    const disabled = options.length ? "" : "disabled";
    return `<select ${attr} ${disabled} data-relation="${esc(fieldDef.relation)}">
      <option value="">${options.length ? `Select ${fieldDef.label}` : `Add ${fieldDef.label.toLowerCase()} records first`}</option>
      ${options.map((optionItem) => `<option value="${esc(optionItem.value)}" ${optionItem.value === value ? "selected" : ""}>${esc(optionItem.label)}</option>`).join("")}
    </select>`;
  }
  if (type === "select" || fieldDef.options?.length) {
    return `<select ${attr}>
      <option value="">${esc(fieldDef.selectPrompt || `Choose ${fieldDef.label}`)}</option>
      ${renderOptions(fieldDef.options || [], value)}
    </select>`;
  }
  if (type === "yesNo") {
    return `<select ${attr}>
      <option value="">Choose yes/no</option>
      ${renderOptions(fieldDef.options || ["Yes", "No", "Unknown / not decided", "Not applicable"], value)}
    </select>`;
  }
  if (type === "textarea") return `<textarea ${attr}>${esc(value)}</textarea>`;
  return `<input ${attr} type="${esc(type)}" value="${esc(value)}" />`;
}

function renderCatalogField(fieldDef, attrs = {}, value = "") {
  const control = renderIntakeFieldControl(fieldDef, {
    placeholder: fieldPlaceholder(fieldDef),
    ...attrs
  }, value);
  return field(fieldDef.label, control, fieldHelp(fieldDef));
}

function renderScalarIntakeFields(code, spec, data) {
  if (!spec.fields?.length) return "";
  return `<div class="grid2">${spec.fields.map((f) => renderCatalogField(f, {
    "data-mvp": code,
    "data-field": f.key
  }, data?.[f.key] || "")).join("")}</div>`;
}

function renderIntakeChecklist(spec) {
  return `<div class="checklist-block"><p class="checklist-label">Topics this module must cover — enter details in the fields and table below</p><ul class="checklist-grid">${(spec.checklist || []).map((item) => `<li><span aria-hidden="true">✓</span>${esc(item)}</li>`).join("")}</ul></div>`;
}

function getResidentOptions() {
  return (state.mvpData?.M5?.residents || []).map((resident) => ({
    value: resident.id,
    label: `${resident.fullLegalName || resident.preferredName || resident.id}${resident.roomBed ? ` — ${resident.roomBed}` : ""}`,
    name: resident.fullLegalName || resident.preferredName || resident.id
  })).filter((optionItem) => optionItem.value);
}

function relationOptions(fieldDef) {
  if (fieldDef.relation === "resident") return getResidentOptions();
  return [];
}

function renderCollectionFieldControl(fieldDef, attrs = {}, value = "", options = {}) {
  const control = renderIntakeFieldControl(fieldDef, attrs, value);
  if (options.withLabel) return field(fieldDef.label, control, fieldHelp(fieldDef));
  return control;
}

function enrichLinkedPayload(payload) {
  const next = { ...payload };
  if (next.residentId) {
    const resident = (state.mvpData?.M5?.residents || []).find((candidate) => candidate.id === next.residentId);
    if (resident) next.residentName = resident.fullLegalName || resident.preferredName || resident.id;
  }
  return next;
}

function enrichCollectionField(fieldDef, collection) {
  const sampleValue = collection.sampleRecord?.[fieldDef.key];
  return {
    ...fieldDef,
    placeholder: fieldDef.placeholder || sampleValue || fieldDef.label,
    sampleValue: fieldDef.sampleValue || sampleValue || ""
  };
}

function renderRecordForm(code, collection) {
  const relationBlocked = (collection.fields || []).some((fieldDef) => fieldDef.relation === "resident") && !getResidentOptions().length;
  return `<form class="inline-form wrap module-record-form" data-module-record-form data-module-code="${esc(code)}" data-collection-key="${esc(collection.key)}">
    ${(collection.fields || []).map((fieldDef) => {
      const enrichedFieldDef = enrichCollectionField(fieldDef, collection);
      return renderCollectionFieldControl(enrichedFieldDef, {
        name: enrichedFieldDef.key,
        placeholder: fieldPlaceholder(enrichedFieldDef),
        required: collection.requiredFields?.includes(enrichedFieldDef.key) ? "required" : ""
      }, "", { withLabel: true });
    }).join("")}
    <button type="submit" ${relationBlocked ? "disabled" : ""}>${relationBlocked ? "Add resident in M5 first" : esc(collection.addLabel || `Add ${collection.label}`)}</button>
  </form>`;
}

function renderEditableRecordCells(code, collectionKey, row, fields) {
  return fields.map((fieldDef) => `<td>${renderCollectionFieldControl(fieldDef, {
    "data-record-field": fieldDef.key,
    "data-record-module": code,
    "data-record-collection": collectionKey,
    "data-record-id": row.id || ""
  }, row[fieldDef.key] || "")}</td>`).join("");
}

function renderRecordTable(code, collection, rows) {
  const fields = collection.fields || [];
  const body = rows.length
    ? rows.map((row) => `<tr>${renderEditableRecordCells(code, collection.key, row, fields)}<td><button type="button" class="danger-button" data-record-delete data-record-module="${esc(code)}" data-record-collection="${esc(collection.key)}" data-record-id="${esc(row.id || "")}">Delete</button></td></tr>`).join("")
    : `<tr><td colspan="${Math.max(fields.length + 1, 1)}">${collection.emptyState ? esc(collection.emptyState) : (code === "M19" ? "No launch scoreboard numbers yet. The COO cannot run the daily go-live huddle until the critical numbers, owners, sources, and red-condition actions are entered here." : `No ${esc(collection.label.toLowerCase())} added yet. Add the first record below to start building this module.`)}</td></tr>`;
  return `<div class="table-wrap compact-table"><table><thead><tr>${fields.map((fieldDef) => `<th>${esc(fieldDef.columnLabel || fieldDef.label)}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderIntakeCoverageSummary() {
  const metrics = scoreFacility(state).moduleMetrics.filter((m) => onboardingIntakeCatalog[m.moduleCode]);
  return `<div class="cards intake-scorecards">${metrics.map((m) => `<div class="card ${m.completenessPct >= 95 ? "ready-soft" : "danger-soft"}"><h4>${esc(m.moduleCode)} ${esc(m.moduleName)}</h4><p>${esc(m.completenessPct ?? 0)}%</p><small>${esc(m.nextAction || "Complete intake")}</small></div>`).join("")}</div>`;
}

function renderOperationalIntakeModules() {
  const metricsByCode = new Map(scoreFacility(state).moduleMetrics.map((metric) => [metric.moduleCode, metric]));
  return Object.entries(onboardingIntakeCatalog).map(([code, spec]) => {
    const module = (state.modules || []).find((m) => m.moduleCode === code) || { moduleCode: code, moduleName: code };
    const metric = metricsByCode.get(code) || {};
    const data = state.mvpData?.[code] || {};
    return `<details open class="intake-module"><summary>${esc(code)} — ${esc(module.moduleName)} <span class="summary-pill">${esc(metric.completenessPct ?? 0)}% complete</span></summary>
      <div class="module-intro">
        <p><strong>${esc(spec.priority)}</strong> — ${esc(spec.purpose)}</p>
        ${renderIntakeChecklist(spec)}
        ${spec.guidanceCards?.length ? `<div class="guidance-cards">${spec.guidanceCards.map((card) => `<div class="guidance-card"><strong>${esc(card.title)}</strong><p>${esc(card.body)}</p></div>`).join("")}</div>` : ""}
      </div>
      ${renderScalarIntakeFields(code, spec, data)}
      ${(spec.collections || []).map((collection) => {
        const rows = Array.isArray(data[collection.key]) ? data[collection.key] : [];
        const needsResident = (collection.fields || []).some((fieldDef) => fieldDef.relation === "resident");
        const residentDependency = needsResident && !getResidentOptions().length ? `<p class="dependency-note">Add the resident in M5 Residents first. Once added, you can select them here by name.</p>` : "";
        return `<section class="collection-block"><div class="row-between"><h4>${esc(collection.label)}</h4><span class="badge badge-info">${rows.length} record(s)</span></div>${residentDependency}${renderRecordForm(code, collection)}${renderRecordTable(code, collection, rows)}</section>`;
      }).join("")}
    </details>`;
  }).join("");
}

function renderModules() {
  const { M1: m1 = {}, M2: m2 = {}, M3: m3 = {}, M4: m4 = {}, M17: m17 = {} } = state.mvpData || {};
  return `
    <h2>Facility DNA Workspace</h2>
    <p class="lead">This is now the complete onboarding intake: residents, rates, care, rounds, staffing, meds, dining, activities, maintenance, admissions, family portal, incidents, vendors, reporting, documents, employees, rooms, and facility/legal DNA.</p>
    ${renderIntakeCoverageSummary()}
    <details open><summary>M1 — Company / Portfolio</summary><div class="grid2">
      ${input({ label: "Parent legal name", "data-mvp": "M1", "data-field": "parentLegalName", value: m1.parentLegalName })}
      ${input({ label: "DBA", "data-mvp": "M1", "data-field": "dba", value: m1.dba })}
      ${input({ label: "Operating LLC", "data-mvp": "M1", "data-field": "operatingLlc", value: m1.operatingLlc, hint: "Distinct from property-holding entity." })}
      ${input({ label: "Property LLC", "data-mvp": "M1", "data-field": "propertyLlc", value: m1.propertyLlc })}
      ${input({ label: "Mailing address", "data-mvp": "M1", "data-field": "mailingAddress", value: m1.mailingAddress })}
      ${input({ label: "Corporate contact", "data-mvp": "M1", "data-field": "corporateContact", value: m1.corporateContact })}
      ${input({ label: "Billing contact", "data-mvp": "M1", "data-field": "billingContact", value: m1.billingContact })}
      ${input({ label: "Time zone", "data-mvp": "M1", "data-field": "timeZone", value: m1.timeZone })}
    </div></details>
    <details open><summary>M2 — Facility Profile</summary><div class="grid2">
      ${input({ label: "Legal name", "data-mvp": "M2", "data-field": "legalName", value: m2.legalName })}
      ${input({ label: "DBA", "data-mvp": "M2", "data-field": "dba", value: m2.dba })}
      ${input({ label: "Facility type", "data-mvp": "M2", "data-field": "facilityType", value: m2.facilityType })}
      ${input({ label: "License number", "data-mvp": "M2", "data-field": "licenseNumber", value: m2.licenseNumber })}
      ${input({ label: "License state", "data-mvp": "M2", "data-field": "licenseState", value: m2.licenseState })}
      ${input({ label: "License agency", "data-mvp": "M2", "data-field": "licenseAgency", value: m2.licenseAgency })}
      ${input({ label: "License expiration", type: "date", "data-mvp": "M2", "data-field": "licenseExpiration", value: m2.licenseExpiration })}
      ${input({ label: "Physical operating address", "data-mvp": "M2", "data-field": "physicalAddress", value: m2.physicalAddress || m2.facilityAddress })}
      ${input({ label: "Mailing address", "data-mvp": "M2", "data-field": "mailingAddress", value: m2.mailingAddress })}
      ${input({ label: "Main phone", "data-mvp": "M2", "data-field": "mainPhone", value: m2.mainPhone })}
      ${input({ label: "After-hours phone", "data-mvp": "M2", "data-field": "afterHoursPhone", value: m2.afterHoursPhone })}
      ${input({ label: "Licensed capacity", type: "number", "data-mvp": "M2", "data-field": "capacity", value: m2.capacity })}
      ${input({ label: "Floors/wings", "data-mvp": "M2", "data-field": "floorsWings", value: m2.floorsWings })}
      ${input({ label: "Executive Director", "data-mvp": "M2", "data-field": "executiveDirector", value: m2.executiveDirector })}
      ${input({ label: "DON / Resident Care", "data-mvp": "M2", "data-field": "don", value: m2.don })}
      ${input({ label: "Maintenance", "data-mvp": "M2", "data-field": "maintenanceDirector", value: m2.maintenanceDirector })}
      ${input({ label: "Business Office", "data-mvp": "M2", "data-field": "businessOfficeManager", value: m2.businessOfficeManager })}
      ${input({ label: "Emergency contact", "data-mvp": "M2", "data-field": "emergencyContact", value: m2.emergencyContact })}
      <label class="field checkbox"><span>Operating address confirmed</span><input type="checkbox" data-mvp="M2" data-field="operatingAddressConfirmed" ${m2.operatingAddressConfirmed ? "checked" : ""}/><small>Required because evidence shows management/mailing address patterns.</small></label>
    </div></details>
    <details open><summary>M3 — Rooms / Beds / Units</summary>
      <div class="grid2">${input({ label: "Beds total", type: "number", "data-mvp": "M3", "data-field": "bedsTotal", value: m3.bedsTotal })}${input({ label: "Units total", type: "number", "data-mvp": "M3", "data-field": "unitsTotal", value: m3.unitsTotal })}</div>
      <form id="m3-room-form" class="inline-form wrap"><input name="roomNumber" placeholder="Room #" required /><input name="floor" placeholder="Floor" /><input name="wing" placeholder="Wing" /><input name="unitType" placeholder="Unit type" /><input name="bedCount" type="number" placeholder="Beds" /><input name="careDesignation" placeholder="Care designation" /><select name="status"><option>active</option><option>offline</option><option>reserved</option></select><button type="submit">Add room</button></form>
      <div class="table-wrap"><table><thead><tr><th>Room</th><th>Floor</th><th>Wing</th><th>Type</th><th>Beds</th><th>Care</th><th>Status</th><th>Actions</th></tr></thead><tbody>${(m3.rooms || []).map((r) => `<tr>${renderEditableRecordCells("M3", "rooms", r, [{ key: "roomNumber", label: "Room" }, { key: "floor", label: "Floor" }, { key: "wing", label: "Wing" }, { key: "unitType", label: "Type" }, { key: "bedCount", label: "Beds", type: "number" }, { key: "careDesignation", label: "Care" }, { key: "status", label: "Status" }])}<td><button type="button" class="danger-button" data-record-delete data-record-module="M3" data-record-collection="rooms" data-record-id="${esc(r.id || "")}">Delete</button></td></tr>`).join("") || "<tr><td colspan='8'>No rooms yet — add one representative room/unit to prove the capture model.</td></tr>"}</tbody></table></div>
    </details>
    <details open><summary>M4 — Employees / Users / Roles</summary>
      ${textarea({ label: "Role coverage notes", "data-mvp": "M4", "data-field": "roleCoverageNotes", value: m4.roleCoverageNotes, hint: "Explain launch coverage for ED/DON/Maintenance/Business Office/app roles." })}
      <form id="m4-employee-form" class="inline-form wrap"><input name="fullLegalName" placeholder="Full legal name" required /><input name="preferredName" placeholder="Preferred" /><input name="emailOrMobile" placeholder="Email/mobile" /><input name="hireDate" type="date" /><select name="employmentStatus"><option>active</option><option>inactive</option><option>terminated</option></select><input name="jobTitle" placeholder="Job title" /><input name="appRole" placeholder="App role" required /><input name="primaryFacility" placeholder="Primary facility" value="Homewood Lodge ALF" /><input name="shiftDepartment" placeholder="Shift/department" /><input name="supervisor" placeholder="Supervisor" /><input name="credentialSummary" placeholder="Credential summary" /><select name="loginStatus"><option>pending</option><option>active</option><option>disabled</option></select><button type="submit">Add employee</button></form>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Preferred</th><th>Contact</th><th>Status</th><th>Job Title</th><th>App Role</th><th>Shift</th><th>Supervisor</th><th>Credential</th><th>Login</th><th>Actions</th></tr></thead><tbody>${(m4.employees || []).map((e) => `<tr>${renderEditableRecordCells("M4", "employees", e, [{ key: "fullLegalName", label: "Name" }, { key: "preferredName", label: "Preferred" }, { key: "emailOrMobile", label: "Contact" }, { key: "employmentStatus", label: "Status" }, { key: "jobTitle", label: "Job Title" }, { key: "appRole", label: "App Role" }, { key: "shiftDepartment", label: "Shift" }, { key: "supervisor", label: "Supervisor" }, { key: "credentialSummary", label: "Credential" }, { key: "loginStatus", label: "Login" }])}<td><button type="button" class="danger-button" data-record-delete data-record-module="M4" data-record-collection="employees" data-record-id="${esc(e.id || "")}">Delete</button></td></tr>`).join("") || "<tr><td colspan='11'>No employees yet — add a representative launch user to show role/credential/login readiness.</td></tr>"}</tbody></table></div>
    </details>
    <details open><summary>M17 — Documents / Insurance / Compliance</summary>
      ${textarea({ label: "Review notes", "data-mvp": "M17", "data-field": "reviewNotes", value: m17.reviewNotes })}
      <p class="small-muted">M17 metadata is edited in Document Intake and drives source-of-truth, currency, custodian approval, and Gate 2 trust.</p>
    </details>
    ${renderOperationalIntakeModules()}
  `;
}

function formatArtifactLabel(value = "") {
  return String(value || "other").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderDetectionCard(intelligence, options = {}) {
  if (!intelligence) {
    return `
      <div class="doc-detected-card empty">
        <strong>Drop or choose a document.</strong>
        <p>The launch center will classify it, pre-fill the metadata, route it to the right module(s), and show what still needs human confirmation.</p>
      </div>
    `;
  }
  const confidence = intelligence.confidence || "low";
  const routes = intelligence.mappedModuleCodes || [];
  return `
    <div class="doc-detected-card">
      <div class="row-between gap">
        <div>
          <p class="eyebrow">Detected facts ${options.saved ? "saved" : "ready for review"}</p>
          <h3>${esc(formatArtifactLabel(intelligence.artifactType))} · ${esc(intelligence.entityAssociation)}</h3>
        </div>
        <span class="confidence-pill confidence-${esc(confidence)}">${esc(confidence)} confidence</span>
      </div>
      <div class="detected-grid">
        <span><strong>Term</strong>${esc(intelligence.term || "Needs confirmation")}</span>
        <span><strong>Currency</strong>${esc(intelligence.currencyStatus || "unknown")}</span>
        <span><strong>Source group</strong>${esc(intelligence.groupName || intelligence.documentGroupId || "New group")}</span>
        <span><strong>Routes</strong>${routes.map((code) => `<b>${esc(code)}</b>`).join(" ") || "M17"}</span>
      </div>
      <p class="small-muted"><strong>Why suggested:</strong> ${esc(intelligence.notes || "Matched filename and document metadata heuristics.")}</p>
      <p class="small-muted"><strong>Human checkpoint:</strong> review the highlighted auto-filled fields, then save. In production this same panel becomes the OCR/AI extraction review queue before facts are pushed into modules.</p>
    </div>
  `;
}

function renderSupabasePipelinePanel() {
  const config = loadPipelineConfig();
  const configured = pipelineConfigured(config);
  return `
    <div class="supabase-pipeline-panel ${configured ? "connected" : ""}">
      <div class="row-between gap">
        <div>
          <p class="eyebrow">Storage mode</p>
          <h3>${configured ? "Supabase OCR/AI connected" : "Local draft workbook — not auto-writing module answers to Supabase yet"}</h3>
          <p class="small-muted"><strong>Plain English:</strong> the answers typed in this Facility Launch page are saved in this browser so the onboarding team can finish the roundtable, export the JSON/markdown, and hand it back for import. The production Supabase parser is built and deployed, but this standalone page needs an authenticated Haven/Supabase session before it can upload documents or write approved facts into Supabase.</p>
        </div>
        <span class="confidence-pill ${configured ? "confidence-high" : "confidence-medium"}">${configured ? "connected" : "local draft"}</span>
      </div>
      <div class="approval-flow">
        <span>Current form entries: browser local draft</span><span>Export creates JSON/markdown handoff</span><span>Connected mode: Storage → OCR/AI → human approval → provenance write</span>
      </div>
      <details class="pipeline-config-details">
        <summary>Advanced: connect Supabase OCR/AI pipeline when logged into Haven</summary>
        <p class="small-muted"><strong>Do not enter real tokens during a screen-shared meeting.</strong> These fields are masked and are only for authenticated Haven testing.</p>
        <div class="grid2 compact-config">
          <input data-pipeline-config="supabaseUrl" placeholder="Supabase URL" value="${esc(config.supabaseUrl || "")}" />
          <input data-pipeline-config="anonKey" type="password" autocomplete="off" placeholder="Supabase anon key" value="${esc(config.anonKey || "")}" />
          <input data-pipeline-config="accessToken" type="password" autocomplete="off" placeholder="Current user JWT / access token" value="${esc(config.accessToken || "")}" />
          <input data-pipeline-config="organizationId" placeholder="Organization UUID" value="${esc(config.organizationId || "")}" />
          <input data-pipeline-config="facilityId" placeholder="Facility UUID (optional but recommended)" value="${esc(config.facilityId || "")}" />
          <button type="button" data-save-pipeline-config>Save Supabase connection</button>
        </div>
      </details>
      ${pipelineMessage ? `<div class="save-callout">${esc(pipelineMessage)}</div>` : ""}
    </div>
  `;
}

function renderDocumentsLaunchNeeds(docs, groups) {
  const stale = docs.filter((doc) => doc.currencyStatus === "stale");
  const pendingApproval = docs.filter((doc) => doc.custodianApprovalStatus !== "approved");
  const unresolvedGroups = groups.filter((group) => (group.documentIds || []).length > 1 && !group.sourceOfTruthDocumentId);
  const missing = [];
  if (!docs.length) missing.push("Upload core evidence: license, GL certificate, property policy, bond, loss runs, floor plan, emergency/vendor documents.");
  if (stale.length) missing.push(`${stale.length} stale document(s) need a refreshed file, route owner, or exception.`);
  if (pendingApproval.length) missing.push(`${pendingApproval.length} document(s) still need custodian approval.`);
  if (unresolvedGroups.length) missing.push(`${unresolvedGroups.length} duplicate/variant group(s) need source-of-truth selection.`);
  if (!docs.some((doc) => (doc.mappedModuleCodes || []).includes("M16"))) missing.push("Claims/risk evidence has not been routed to M16 yet.");
  if (!docs.some((doc) => (doc.mappedModuleCodes || []).includes("M18"))) missing.push("Vendor/emergency evidence has not been routed to M18 yet.");
  return `
    <div class="doc-needs-panel">
      <h3>What document intake still needs</h3>
      <ul>${(missing.length ? missing : ["Document intake has source-of-truth, currency, routing, and approval coverage for demo launch."]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function markAutoFilledFields(form) {
  form?.querySelectorAll("[data-auto-field]").forEach((control) => {
    control.classList.toggle("auto-filled", Boolean(control.value));
  });
}

function applyDocumentIntelligenceToForm(form, fileName) {
  if (!form || !fileName) return;
  const intelligence = inferDocumentIntelligence(fileName);
  for (const [name, value] of Object.entries({
    title: intelligence.title,
    artifactType: intelligence.artifactType,
    entityAssociation: intelligence.entityAssociation,
    term: intelligence.term,
    effectiveDate: intelligence.effectiveDate,
    expirationDate: intelligence.expirationDate,
    currencyStatus: intelligence.currencyStatus,
    version: intelligence.version,
    custodianApprovalStatus: intelligence.custodianApprovalStatus,
    confidence: intelligence.confidence,
    notes: intelligence.notes,
    documentGroupId: intelligence.documentGroupId,
    groupName: intelligence.groupName,
    mappedModuleCodes: intelligence.mappedModuleCodes.join(",")
  })) {
    const control = form.querySelector(`[name='${name}']`);
    if (control) control.value = value || "";
  }
  markAutoFilledFields(form);
  const preview = document.getElementById("doc-intelligence-preview");
  if (preview) preview.innerHTML = renderDetectionCard(intelligence);
}

function renderDocs() {
  const groups = state.documentGroups || [];
  const docs = state.documents || [];
  const unresolvedGroups = groups.filter((g) => (g.documentIds || []).length > 1 && !g.sourceOfTruthDocumentId);
  return `
    <h2>Document Intake + Source-of-Truth Resolver</h2>
    <p class="lead">Drop a document here first. The launch center classifies what it appears to be, pre-fills the launch metadata, routes it to the affected modules, flags stale/duplicate evidence, and immediately updates readiness after save. Current demo automation is filename/metadata based; production extraction should add Supabase Storage + OCR/AI parsing + human approval before facts write into modules.</p>
    ${lastDocumentSaveSummary ? `<div class="save-callout">${esc(lastDocumentSaveSummary)}</div>` : ""}
    ${renderSupabasePipelinePanel()}
    ${renderDocumentsLaunchNeeds(docs, groups)}
    ${unresolvedGroups.length ? `<div class="source-resolver-banner"><strong>Source-of-truth needed:</strong> ${unresolvedGroups.map((group) => esc(group.name)).join(", ")}. Select the canonical document below before Gate 2.</div>` : ""}
    <form id="document-form" class="grid2 intake-card doc-upload-card">
      <label class="doc-drop-zone" for="doc-file-input">
        <input id="doc-file-input" type="file" name="file" />
        <span class="drop-icon">📄</span>
        <strong>Drop a PDF or choose file</strong>
        <small>Auto-detects type, entity, dates, duplicate group, and module route.</small>
      </label>
      <input name="title" placeholder="Document title (auto-filled from file name)" required data-auto-field />
      <select name="artifactType" data-auto-field>${ARTIFACT_TYPES.map((v) => option(v, "gl_cert")).join("")}</select>
      <input name="entityAssociation" placeholder="Facility/entity association" value="Homewood Lodge ALF" data-auto-field />
      <input name="term" placeholder="Term/year" data-auto-field />
      <input name="effectiveDate" type="date" data-auto-field />
      <input name="expirationDate" type="date" data-auto-field />
      <select name="currencyStatus" data-auto-field>${CURRENCY_STATUSES.map((v) => option(v, "unknown")).join("")}</select>
      <input name="version" placeholder="Version" value="v1" data-auto-field />
      <select name="custodianApprovalStatus" data-auto-field>${APPROVAL_STATUSES.map((v) => option(v, "pending")).join("")}</select>
      <select name="confidence" data-auto-field>${CONFIDENCE_LEVELS.map((v) => option(v, "manual")).join("")}</select>
      <input name="notes" placeholder="Confidence notes" data-auto-field />
      <input type="hidden" name="documentGroupId" />
      <input type="hidden" name="groupName" />
      <input type="hidden" name="mappedModuleCodes" />
      <div id="doc-intelligence-preview" class="doc-intelligence-preview">${renderDetectionCard(null)}</div>
      <button type="submit">Confirm and save classified document</button>
      <button type="button" class="secondary-button" data-supabase-ocr-upload>Upload to Supabase OCR/AI pipeline</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Document</th><th>Artifact</th><th>Facility/Entity</th><th>Term</th><th>Effective</th><th>Expiration</th><th>Version</th><th>Currency</th><th>Approval</th><th>Confidence/Notes</th><th>Route/Exception</th><th>Actions</th></tr></thead><tbody>
      ${docs.map((d) => `<tr>
        <td><strong>${esc(d.title)}</strong><br><small>${d.isSourceOfTruth ? "Source of truth" : "variant/intake"}</small>${d.mappedModuleCodes?.length ? `<br><span class="route-chip-row">${d.mappedModuleCodes.map((code) => `<b>${esc(code)}</b>`).join(" ")}</span>` : ""}${d.automationSummary ? `<br><small>${esc(d.automationSummary)}</small>` : ""}</td>
        <td><select data-doc-field="artifactType" data-doc-id="${d.id}">${ARTIFACT_TYPES.map((v) => option(v, d.artifactType)).join("")}</select></td>
        <td><input data-doc-field="entityAssociation" data-doc-id="${d.id}" value="${esc(d.entityAssociation || d.facilityName || "")}" /></td>
        <td><input data-doc-field="term" data-doc-id="${d.id}" value="${esc(d.term || "")}" /></td>
        <td><input type="date" data-doc-field="effectiveDate" data-doc-id="${d.id}" value="${esc(d.effectiveDate || "")}" /></td>
        <td><input type="date" data-doc-field="expirationDate" data-doc-id="${d.id}" value="${esc(d.expirationDate || "")}" /></td>
        <td><input data-doc-field="version" data-doc-id="${d.id}" value="${esc(d.version || "")}" /></td>
        <td><select data-doc-field="currencyStatus" data-doc-id="${d.id}">${CURRENCY_STATUSES.map((v) => option(v, d.currencyStatus)).join("")}</select>${currencyBadge(d.currencyStatus)}</td>
        <td><select data-doc-field="custodianApprovalStatus" data-doc-id="${d.id}">${APPROVAL_STATUSES.map((v) => option(v, d.custodianApprovalStatus)).join("")}</select></td>
        <td><select data-doc-field="confidence" data-doc-id="${d.id}">${CONFIDENCE_LEVELS.map((v) => option(v, d.confidence)).join("")}</select><input data-doc-field="notes" data-doc-id="${d.id}" value="${esc(d.notes || "")}" /></td>
        <td>${d.currencyStatus === "stale" ? `<input data-route-doc="${d.id}" placeholder="Route owner" value="${esc(d.routedOwnerName || "")}" /><button data-doc-exception="${d.id}">Request Exception</button>` : "No stale action"}</td>
        <td><button type="button" class="danger-button" data-doc-delete="${esc(d.id)}">Delete</button></td>
      </tr>`).join("") || "<tr><td colspan='12'>No documents entered yet — upload a license, insurance certificate, policy, bond, loss run, floor plan, or emergency/vendor document to start source-of-truth resolution.</td></tr>"}
    </tbody></table></div>
    <h3>Duplicate / Variant Groups</h3>
    <div class="cards">${groups.filter((g) => (g.documentIds || []).length > 1).map((g) => `<div class="card"><h4>${esc(g.name)}</h4><p>${g.sourceOfTruthDocumentId ? "Resolved" : "Unresolved"}</p><select data-sot-group="${g.id}"><option value="">Select source of truth</option>${g.documentIds.map((id) => {
      const d = docs.find((x) => x.id === id);
      return `<option value="${id}" ${g.sourceOfTruthDocumentId === id ? "selected" : ""}>${esc(d?.title || id)}</option>`;
    }).join("")}</select><small>Only documents in this group are accepted.</small></div>`).join("")}</div>
  `;
}

function renderExceptions() {
  const rows = (state.exceptions || []).map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.scopeType)}:${esc(e.scopeId)}</td><td>${esc(e.description || "")}</td><td>${statusBadge(e.status)}</td><td>${esc(e.ownerName || "")}</td><td>${esc(e.approverName || "")} ${e.approverRole ? `(${esc(e.approverRole)})` : ""}</td><td>${e.status === "requested" ? `<input data-ex-name="${e.id}" placeholder="Approver name" /><input data-ex-role="${e.id}" placeholder="Approver role" /><button data-ex-approve="${e.id}">Approve</button>` : ""} ${e.status !== "closed" ? `<button data-ex-close="${e.id}">Close</button>` : ""}</td></tr>`).join("");
  return `
    <h2>Exceptions</h2>
    <p class="lead">Exceptions are explicit launch waivers with approver name, role, and decision history captured for the onboarding record.</p>
    <form id="exception-form" class="grid2">
      <label class="field"><span>What are we creating an exception for?</span><select name="scopeType" required><option value="document">A specific document</option><option value="module">An onboarding module</option><option value="rule">A rule or policy</option></select><small>Choose the type first. Use the exact module code (M16) or document title/id in the next field.</small></label>
      <label class="field"><span>Which document, module, or rule?</span><input name="scopeId" placeholder="Example: M16 or HOMEWOOD GL CERT.pdf" required /><small>For a module, enter M1–M19. For a document, enter the document title shown in Document Intake.</small></label>
      <label class="field"><span>Who owns clearing this exception?</span><input name="ownerName" placeholder="Example: CFO, ED, DON, Document Custodian" required /></label>
      <label class="field"><span>Why is this exception acceptable for launch?</span><input name="description" placeholder="Example: Current COI requested from broker; CFO approves temporary launch exception." required /></label>
      <label class="field"><span>How serious is it?</span><select name="severity"><option value="major">Major — leadership approval needed</option><option value="minor">Minor — track and close</option><option value="blocking">Blocking — cannot launch until resolved or approved</option></select></label>
      <button type="submit">Add Exception</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Scope</th><th>Description</th><th>Status</th><th>Owner</th><th>Approval</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
  `;
}

function renderContradictions() {
  const rows = (state.contradictions || []).map((c) => `<tr>
    <td>${esc(c.id)}<br>${statusBadge(c.status)}</td>
    <td><select data-ctr-field="type" data-ctr-id="${c.id}">${["policy_reality_app", "document_document", "document_field", "entity_match", "currency", "ownership", "other"].map((v) => option(v, c.type)).join("")}</select><select data-ctr-field="severity" data-ctr-id="${c.id}">${["minor", "major", "blocking"].map((v) => option(v, c.severity)).join("")}</select></td>
    <td><textarea data-ctr-field="summary" data-ctr-id="${c.id}">${esc(c.summary)}</textarea></td>
    <td><textarea data-ctr-field="policyValue" data-ctr-id="${c.id}">${esc(c.policyValue || "")}</textarea></td>
    <td><textarea data-ctr-field="realityValue" data-ctr-id="${c.id}">${esc(c.realityValue || "")}</textarea></td>
    <td><textarea data-ctr-field="appSettingValue" data-ctr-id="${c.id}">${esc(c.appSettingValue || "")}</textarea></td>
    <td><input data-ctr-field="decisionOwner" data-ctr-id="${c.id}" value="${esc(c.decisionOwner || "")}" placeholder="Decision owner" /><input data-ctr-owner="${c.id}" value="${esc(c.ownerName || "")}" placeholder="Assigned owner" /></td>
    <td><textarea data-ctr-field="resolutionNotes" data-ctr-id="${c.id}" placeholder="Resolution notes">${esc(c.resolutionNotes || "")}</textarea></td>
    <td>${c.status === "open" ? `<button data-ctr-save-owner="${c.id}">Save Owner</button> <button data-ctr-resolve="${c.id}">Resolve</button>` : ""}</td>
  </tr>`).join("");
  return `
    <h2>Policy vs Reality Checks</h2>
    <p class="lead">Use this when policy, real-world practice, and app settings do not match. Each item needs an owner and a resolution before launch trust is complete.</p>
    <form id="contradiction-form" class="grid2">
      <select name="type"><option>policy_reality_app</option><option>document_document</option><option>other</option></select>
      <select name="severity"><option>major</option><option>minor</option><option>blocking</option></select>
      <input name="ownerName" placeholder="Assigned owner" />
      <input name="decisionOwner" placeholder="Decision owner" />
      <input name="summary" placeholder="Summary" required />
      <input name="policyValue" placeholder="Policy value" />
      <input name="realityValue" placeholder="Reality value" />
      <input name="appSettingValue" placeholder="App setting value" />
      <button type="submit">Add Contradiction</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Type/Severity</th><th>Summary</th><th>Policy</th><th>Reality</th><th>App Setting</th><th>Owners</th><th>Resolution</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>
  `;
}

function renderGatePanel(gateCode, evaluation) {
  const saved = (state.gates || []).find((g) => g.code === gateCode) || {};
  const signed = Boolean(saved.signedAt);
  const gateStatus = signed ? "SIGNED" : evaluation.pass ? "READY" : "BLOCKED";
  const signerRole = saved.requiredSignerRole || evaluation.requiredSignerRole || "Authorized signer";
  return `
    <div class="panel gate-panel">
      <div class="row-between"><h3>${gateCode} — ${gateStatus}</h3><span class="badge badge-info">Required signer: ${esc(signerRole)}</span></div>
      <ul class="criteria-list">
        ${evaluation.criteria.map((c) => `<li class="${c.pass ? "ok" : "fail"}"><strong>${c.pass ? "PASS" : "FAIL"}</strong> ${esc(c.label)} ${c.pass ? "" : `<small>${esc(c.blocker)}</small>`}</li>`).join("")}
      </ul>
      <div class="inline-form">
        <input data-gate-signer="${gateCode}" placeholder="Signer name" value="${esc(saved.signedBy || "")}" ${signed ? "disabled" : ""} />
        <input data-gate-role="${gateCode}" placeholder="Signer role" value="${esc(saved.signedRole || signerRole)}" ${signed ? "disabled" : ""} />
        <button data-gate-sign="${gateCode}" ${!evaluation.pass || signed ? "disabled" : ""}>Sign ${gateCode}</button>
      </div>
      ${signed ? `<p class='small-muted'>Signed by ${esc(saved.signedBy)} (${esc(saved.signedRole)}) at ${esc(saved.signedAt)}</p>` : ""}
    </div>
  `;
}

function renderGates() {
  return `<h2>Gate Checks</h2><p class="lead">Gates are deterministic snapshots. Sign-off stores signer, role, timestamp, criteria, and approved exceptions relied upon.</p>${renderGatePanel("G0", evaluateGate0(state))}${renderGatePanel("G2", evaluateGate2(state))}`;
}

function renderPushToHavenPanel() {
  const config = loadPipelineConfig();
  const ready = pipelineConfigured(config);
  const buttonLabel = pushBusy
    ? (pushDryRun ? "Previewing..." : "Pushing...")
    : (pushDryRun ? "Preview push (no writes)" : "Push to Haven");
  const dryRunChecked = pushDryRun ? "checked" : "";

  return `
    <div class="supabase-pipeline-panel ${ready ? "connected" : ""}">
      <div class="row-between gap">
        <div>
          <p class="eyebrow">Push to Haven</p>
          <h3>${ready ? "Write this state into Haven's facility_launch_module_values" : "Connect Supabase first (see Document Intake tab)"}</h3>
          <p class="small-muted">Sends the current state to the <code>facility-launch-import</code> Edge Function. Source-backed fields are inserted or updated under <code>(organization_id, facility_id, module_code, field_path)</code>. Round-2 gap modules (M4, M5, M7, M8, M9, M12, M15) are skipped.</p>
        </div>
        <span class="confidence-pill ${ready ? "confidence-high" : "confidence-medium"}">${ready ? "ready" : "not connected"}</span>
      </div>
      <div class="row-between gap">
        <label class="small-muted"><input type="checkbox" data-push-dry-run ${dryRunChecked} /> Preview only (dry-run — no writes)</label>
        <button type="button" data-push-to-haven ${ready && !pushBusy ? "" : "disabled"}>${esc(buttonLabel)}</button>
      </div>
      ${pushError ? `<div class="save-callout" style="border-color:#c0392b;background:#fff5f5">${esc(pushError)}</div>` : ""}
      ${pushResult ? renderPushResult(pushResult) : ""}
    </div>
  `;
}

function renderPushResult(result) {
  const summary = `${result.mode === "dry_run" ? "Dry-run plan" : "Applied"}: inserts=${result.inserts} updates=${result.updates} noop=${result.noops} (${result.payload_count} source-backed field${result.payload_count === 1 ? "" : "s"})`;
  const gapRows = (result.gap_report || []).map((g) => `<tr><td>${esc(g.module)}</td><td><span class="badge badge-${esc(g.status)}">${esc(g.status)}</span></td><td>${esc((g.missing_fields || []).join(", ") || "—")}</td></tr>`).join("");
  const changeRows = (result.rows || [])
    .filter((r) => r.change !== "noop")
    .map((r) => `<tr><td>${esc(r.module_code)}</td><td>${esc(r.field_path)}</td><td><span class="badge badge-${r.change === "insert" ? "info" : "watch"}">${esc(r.change)}</span></td><td><code>${esc(r.preview)}</code></td></tr>`).join("");
  const skipped = (result.skipped_modules || []).map((s) => `<li>${esc(s)}</li>`).join("");
  return `
    <div class="save-callout"><strong>${esc(summary)}</strong></div>
    <details open class="pipeline-config-details">
      <summary>Gap report (${(result.gap_report || []).length} modules)</summary>
      <div class="table-wrap compact-table">
        <table><thead><tr><th>Module</th><th>Status</th><th>Missing fields</th></tr></thead>
        <tbody>${gapRows || "<tr><td colspan='3'>—</td></tr>"}</tbody></table>
      </div>
    </details>
    <details class="pipeline-config-details">
      <summary>Changes (${(result.rows || []).filter((r) => r.change !== "noop").length})</summary>
      <div class="table-wrap compact-table">
        <table><thead><tr><th>Module</th><th>Field</th><th>Change</th><th>Preview</th></tr></thead>
        <tbody>${changeRows || "<tr><td colspan='4'>No changes</td></tr>"}</tbody></table>
      </div>
    </details>
    ${skipped ? `<details class="pipeline-config-details"><summary>Skipped modules</summary><ul>${skipped}</ul></details>` : ""}
  `;
}

function renderExport() {
  return `
    <h2>Executive Export</h2>
    <p class="lead">Generate a markdown packet with launch narrative, signed gates, criteria snapshot, exceptions, source-of-truth decisions, contradictions, and recent decision log excerpts.</p>
    ${renderPushToHavenPanel()}
    <button id="generate-export">Generate Readiness Export</button>
    <h3>Markdown Readiness Summary</h3>
    <textarea id="export-markdown" rows="16" placeholder="Generate export..."></textarea>
    <h3>Technical Data Export (JSON)</h3>
    <textarea id="export-json" rows="16" placeholder="Generate export..."></textarea>
  `;
}

function renderView() {
  if (activeTab === "overview") viewEl.innerHTML = renderOverview();
  if (activeTab === "program") viewEl.innerHTML = renderProgram();
  if (activeTab === "worksheet") viewEl.innerHTML = renderWorksheet();
  if (activeTab === "readiness") viewEl.innerHTML = renderReadiness();
  if (activeTab === "modules") viewEl.innerHTML = renderModules();
  if (activeTab === "docs") viewEl.innerHTML = renderDocs();
  if (activeTab === "exceptions") viewEl.innerHTML = renderExceptions();
  if (activeTab === "contradictions") viewEl.innerHTML = renderContradictions();
  if (activeTab === "gates") viewEl.innerHTML = renderGates();
  if (activeTab === "export") viewEl.innerHTML = renderExport();
}

function decisionActionLabel(actionType = "") {
  const labels = {
    program_charter_updated: "Program Charter updated",
    owner_assignment_updated: "Module owner updated",
    module_intake_record_added: "Onboarding record added",
    module_intake_record_updated: "Onboarding record updated",
    module_intake_record_deleted: "Onboarding record deleted",
    mvp_data_updated: "Onboarding field updated",
    document_added: "Document added",
    document_updated: "Document updated",
    document_deleted: "Document deleted",
    exception_requested: "Exception requested",
    exception_approved: "Exception approved",
    exception_closed: "Exception closed",
    contradiction_added: "Policy/reality check added",
    contradiction_updated: "Policy/reality check updated",
    contradiction_resolved: "Policy/reality check resolved",
    gate_signed: "Gate signed",
    export_generated: "Readiness export generated"
  };
  return labels[actionType] || String(actionType || "Activity").replaceAll("_", " ");
}

function renderDecisionLog() {
  decisionLogEl.innerHTML = (state.decisionLog || []).slice(0, 20).map((d) => `<li><strong>${esc(decisionActionLabel(d.actionType))}</strong> — ${esc(d.summary)}</li>`).join("");
}

function render() {
  renderTabs();
  renderSummary();
  renderView();
  renderDecisionLog();
}

document.body.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    activeTab = tab.dataset.tab;
    render();
    return;
  }

  const deleteRecord = e.target.closest("[data-record-delete]");
  if (deleteRecord) {
    if (!window.confirm("Delete this record? This cannot be undone.")) return;
    state = deleteModuleRecord(state, deleteRecord.dataset.recordModule, deleteRecord.dataset.recordCollection, deleteRecord.dataset.recordId);
    render();
    return;
  }

  const deleteDoc = e.target.closest("[data-doc-delete]");
  if (deleteDoc) {
    if (!window.confirm("Delete this document row? This cannot be undone.")) return;
    state = deleteDocument(state, deleteDoc.dataset.docDelete);
    lastDocumentSaveSummary = "Document row deleted. Readiness and source-of-truth groups were recalculated.";
    render();
    return;
  }

  const savePipeline = e.target.closest("[data-save-pipeline-config]");
  if (savePipeline) {
    const config = Object.fromEntries(Array.from(document.querySelectorAll("[data-pipeline-config]")).map((input) => [input.dataset.pipelineConfig, input.value]));
    savePipelineConfig(config);
    pipelineMessage = "Supabase OCR/AI pipeline connection saved in this browser.";
    render();
    return;
  }

  const supabaseUpload = e.target.closest("[data-supabase-ocr-upload]");
  if (supabaseUpload) {
    const form = supabaseUpload.closest("form");
    const file = form?.querySelector("#doc-file-input")?.files?.[0];
    const title = form?.querySelector("[name='title']")?.value || file?.name || "Uploaded document";
    supabaseUpload.disabled = true;
    pipelineMessage = "Uploading to Supabase Storage, converting document text, and running parser job...";
    renderSummary();
    try {
      const result = await uploadDocumentToSupabasePipeline(file, { title });
      pipelineMessage = `Supabase OCR/AI complete. Document ${result.ingest.document_id} parsed with ${result.parsed.fact_count || 0} fact(s) waiting for human approval/provenance apply.`;
    } catch (error) {
      pipelineMessage = error instanceof Error ? error.message : "Supabase OCR/AI pipeline failed.";
    }
    render();
    return;
  }

  const approve = e.target.closest("[data-ex-approve]");
  if (approve) {
    const id = approve.dataset.exApprove;
    const name = document.querySelector(`[data-ex-name='${id}']`)?.value || "";
    const role = document.querySelector(`[data-ex-role='${id}']`)?.value || "";
    state = approveException(state, id, name, role);
    render();
    return;
  }

  const close = e.target.closest("[data-ex-close]");
  if (close) {
    state = closeException(state, close.dataset.exClose);
    render();
    return;
  }

  const resolve = e.target.closest("[data-ctr-resolve]");
  if (resolve) {
    const id = resolve.dataset.ctrResolve;
    const notes = document.querySelector(`[data-ctr-field='resolutionNotes'][data-ctr-id='${id}']`)?.value || "";
    const owner = document.querySelector(`[data-ctr-owner='${id}']`)?.value || "user";
    state = resolveContradiction(state, id, notes, owner);
    render();
    return;
  }

  const saveOwner = e.target.closest("[data-ctr-save-owner]");
  if (saveOwner) {
    const id = saveOwner.dataset.ctrSaveOwner;
    const input = document.querySelector(`[data-ctr-owner='${id}']`);
    state = assignContradictionOwner(state, id, input?.value || "");
    render();
    return;
  }

  const requestDocException = e.target.closest("[data-doc-exception]");
  if (requestDocException) {
    const docId = requestDocException.dataset.docException;
    state = addException(state, {
      scopeType: "document",
      scopeId: docId,
      ownerName: "Document Custodian",
      description: `Exception request for stale document ${docId}`,
      severity: "major"
    });
    render();
    return;
  }

  const signBtn = e.target.closest("[data-gate-sign]");
  if (signBtn) {
    const code = signBtn.dataset.gateSign;
    const signerInput = document.querySelector(`[data-gate-signer='${code}']`);
    const roleInput = document.querySelector(`[data-gate-role='${code}']`);
    const evaluation = code === "G0" ? evaluateGate0(state) : evaluateGate2(state);
    state = signGate(state, code, signerInput?.value || "", roleInput?.value || evaluation.requiredSignerRole, evaluation);
    render();
    return;
  }

  const pushBtn = e.target.closest("[data-push-to-haven]");
  if (pushBtn) {
    if (pushBusy) return;
    pushBusy = true;
    pushError = "";
    pushResult = null;
    renderView();
    try {
      const exportPayload = JSON.parse(buildStateJsonExport(state));
      const result = await pushStateToHaven(exportPayload, { dryRun: pushDryRun });
      pushResult = result;
      state = appendDecisionLog(state, {
        actionType: pushDryRun ? "push_to_haven_previewed" : "push_to_haven_applied",
        summary: `${pushDryRun ? "Previewed" : "Applied"} push to Haven — inserts=${result.inserts}, updates=${result.updates}, noop=${result.noops}.`,
        relatedType: "facility",
        relatedId: state.facility?.id || "facility"
      });
    } catch (err) {
      pushError = err instanceof Error ? err.message : "Push failed.";
    } finally {
      pushBusy = false;
      render();
    }
    return;
  }

  const doExport = e.target.closest("#generate-export");
  if (doExport) {
    const md = buildReadinessMarkdown(state);
    const json = buildStateJsonExport(state);
    const mdEl = document.getElementById("export-markdown");
    const jsonEl = document.getElementById("export-json");
    if (mdEl) mdEl.value = md;
    if (jsonEl) jsonEl.value = json;
    state = appendDecisionLog(state, {
      actionType: "export_generated",
      summary: "Generated executive markdown + JSON readiness export.",
      relatedType: "facility",
      relatedId: state.facility.id
    });
    renderDecisionLog();
  }
});

function refreshAfterDataChange() {
  renderSummary();
  if (["modules", "readiness", "gates", "export"].includes(activeTab)) renderView();
}

document.body.addEventListener("change", (e) => {
  const dryToggle = e.target.closest("[data-push-dry-run]");
  if (dryToggle) {
    pushDryRun = Boolean(dryToggle.checked);
    renderView();
    return;
  }

  const program = e.target.closest("[data-program]");
  if (program) {
    state = updateProgramField(state, program.dataset.program, program.value);
    renderSummary();
    return;
  }

  const threshold = e.target.closest("[data-threshold]");
  if (threshold) {
    state = updateProgramThreshold(state, threshold.dataset.threshold, threshold.value);
    renderSummary();
    return;
  }

  const ws = e.target.closest("[data-ws]");
  if (ws) {
    state = updateOwnerWorksheetRow(state, ws.dataset.code, { [ws.dataset.ws]: ws.value });
    renderSummary();
    return;
  }

  const mvp = e.target.closest("[data-mvp]");
  if (mvp) {
    const value = mvp.type === "checkbox" ? mvp.checked : mvp.value;
    state = updateMvpDataField(state, mvp.dataset.mvp, mvp.dataset.field, value);
    refreshAfterDataChange();
    return;
  }

  const recordField = e.target.closest("[data-record-field]");
  if (recordField) {
    state = updateModuleRecord(state, recordField.dataset.recordModule, recordField.dataset.recordCollection, recordField.dataset.recordId, enrichLinkedPayload({ [recordField.dataset.recordField]: recordField.value }));
    refreshAfterDataChange();
    return;
  }

  const docField = e.target.closest("[data-doc-field]");
  if (docField) {
    state = updateDocument(state, docField.dataset.docId, { [docField.dataset.docField]: docField.value });
    refreshAfterDataChange();
    return;
  }

  const ctrField = e.target.closest("[data-ctr-field]");
  if (ctrField) {
    state = updateContradiction(state, ctrField.dataset.ctrId, { [ctrField.dataset.ctrField]: ctrField.value });
    renderSummary();
    return;
  }

  const sot = e.target.closest("[data-sot-group]");
  if (sot && sot.value) {
    state = selectSourceOfTruthDocument(state, sot.dataset.sotGroup, sot.value);
    render();
    return;
  }

  const route = e.target.closest("[data-route-doc]");
  if (route) {
    state = routeStaleDocument(state, route.dataset.routeDoc, route.value);
    refreshAfterDataChange();
    return;
  }

  if (e.target.id === "doc-file-input") {
    const fileName = e.target.files?.[0]?.name || "";
    applyDocumentIntelligenceToForm(e.target.form, fileName);
  }
});

document.body.addEventListener("dragover", (e) => {
  const zone = e.target.closest(".doc-drop-zone");
  if (!zone) return;
  e.preventDefault();
  zone.classList.add("dragging");
});

document.body.addEventListener("dragleave", (e) => {
  const zone = e.target.closest(".doc-drop-zone");
  if (!zone) return;
  zone.classList.remove("dragging");
});

document.body.addEventListener("drop", (e) => {
  const zone = e.target.closest(".doc-drop-zone");
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove("dragging");
  const input = zone.querySelector("input[type='file']");
  if (!input || !e.dataTransfer?.files?.length) return;
  input.files = e.dataTransfer.files;
  applyDocumentIntelligenceToForm(input.form, input.files[0]?.name || "");
});

document.body.addEventListener("submit", (e) => {
  if (e.target.matches("[data-module-record-form]")) {
    e.preventDefault();
    const fd = new FormData(e.target);
    state = addModuleRecord(state, e.target.dataset.moduleCode, e.target.dataset.collectionKey, enrichLinkedPayload(Object.fromEntries(fd.entries())));
    e.target.reset();
    render();
    return;
  }

  if (e.target.id === "exception-form") {
    e.preventDefault();
    const fd = new FormData(e.target);
    state = addException(state, {
      scopeType: fd.get("scopeType"),
      scopeId: fd.get("scopeId"),
      ownerName: fd.get("ownerName"),
      description: fd.get("description"),
      severity: fd.get("severity")
    });
    render();
    return;
  }

  if (e.target.id === "contradiction-form") {
    e.preventDefault();
    const fd = new FormData(e.target);
    state = addContradiction(state, Object.fromEntries(fd.entries()));
    render();
    return;
  }

  if (e.target.id === "document-form") {
    e.preventDefault();
    const beforeScore = scoreFacility(state).facilityReadinessScore;
    const fd = new FormData(e.target);
    const file = fd.get("file");
    const title = String(fd.get("title") || file?.name || "document");
    state = addDocument(state, { ...Object.fromEntries(fd.entries()), mappedModuleCodes: String(fd.get("mappedModuleCodes") || "").split(",").filter(Boolean), fileName: file?.name || "" });
    const afterScore = scoreFacility(state).facilityReadinessScore;
    lastDocumentSaveSummary = `Saved ${title}. Readiness recalculated from ${beforeScore} to ${afterScore}. Routed modules: ${String(fd.get("mappedModuleCodes") || "M17") || "M17"}.`;
    e.target.reset();
    render();
    return;
  }

  if (e.target.id === "m3-room-form") {
    e.preventDefault();
    state = addM3Room(state, Object.fromEntries(new FormData(e.target).entries()));
    e.target.reset();
    render();
    return;
  }

  if (e.target.id === "m4-employee-form") {
    e.preventDefault();
    state = addM4Employee(state, Object.fromEntries(new FormData(e.target).entries()));
    e.target.reset();
    render();
  }
});

function isEmptyOnboardingShell(currentState) {
  const actionTypes = new Set((currentState.decisionLog || []).map((entry) => entry.actionType));
  const onlyShellActions = [...actionTypes].every((actionType) => ["empty_onboarding_initialized", "empty_onboarding_reset"].includes(actionType));
  return !currentState.ingestionManifest
    && (currentState.documents || []).length === 0
    && (currentState.documentGroups || []).length === 0
    && (currentState.ingestionGaps || []).length === 0
    && (currentState.ingestionReviewQueue || []).length === 0
    && (currentState.mvpData?.M3?.rooms || []).length === 0
    && onlyShellActions;
}

async function loadRound1Import({ actor = "system", actionType = "round1_real_import_loaded" } = {}) {
  try {
    const response = await fetch(ROUND1_STATE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Round 1 state fetch failed: ${response.status}`);
    const importedState = await response.json();
    state = saveState(importedState);
    state = appendDecisionLog(state, {
      actor,
      actionType,
      summary: "Loaded generated Homewood Round 1 real onboarding state; no demo fixture data loaded.",
      relatedType: "facility",
      relatedId: state.facility?.id || "fac-homewood"
    });
    pipelineMessage = "Homewood Round 1 import loaded from generated real onboarding artifacts.";
    render();
    return true;
  } catch (error) {
    console.error(error);
    pipelineMessage = `Unable to load Round 1 import: ${error.message}`;
    render();
    return false;
  }
}

loadRound1Button?.addEventListener("click", async () => {
  await loadRound1Import({ actor: "user" });
});

resetButton.addEventListener("click", () => {
  state = resetState();
  state = appendDecisionLog(state, {
    actor: "user",
    actionType: "empty_onboarding_reset",
    summary: "Reset onboarding shell triggered; no demo fixture data loaded.",
    relatedType: "facility",
    relatedId: state.facility.id
  });
  render();
});

if (isEmptyOnboardingShell(state)) {
  loadRound1Import({ actor: "system", actionType: "round1_real_import_auto_loaded" });
} else {
  render();
}
