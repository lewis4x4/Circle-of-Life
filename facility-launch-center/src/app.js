import {
  loadState,
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

let state = loadState();
let activeTab = "overview";

const tabsEl = document.getElementById("tabs");
const summaryEl = document.getElementById("summary");
const viewEl = document.getElementById("view");
const decisionLogEl = document.getElementById("decision-log");
const resetButton = document.getElementById("reset-demo");

const MODULE_STATUSES = ["not_started", "assigned", "in_progress", "ready_for_review", "signed", "blocked"];
const SCOPE_STATUSES = ["in", "out", "tbd"];
const ARTIFACT_TYPES = ["state_license", "gl_cert", "property_insurance", "property_policy", "bond_certificate", "loss_run", "floor_plan", "emergency_plan", "vendor_agreement", "compilation_file", "other"];
const CURRENCY_STATUSES = ["fresh", "aging", "stale", "unknown"];
const APPROVAL_STATUSES = ["pending", "approved", "rejected", "needs_review"];
const CONFIDENCE_LEVELS = ["low", "medium", "high", "manual"];

const tabs = [
  ["overview", "Facility Command Center"],
  ["program", "Program Charter"],
  ["worksheet", "Accountability Matrix"],
  ["readiness", "Readiness Map"],
  ["modules", "Complete Intake / Facility DNA"],
  ["docs", "Document Intake"],
  ["exceptions", "Exceptions"],
  ["contradictions", "Contradictions"],
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

function renderScalarIntakeFields(code, spec, data) {
  if (!spec.fields?.length) return "";
  return `<div class="grid2">${spec.fields.map((f) => input({
    label: f.label,
    type: f.type || "text",
    "data-mvp": code,
    "data-field": f.key,
    value: data?.[f.key] || "",
    hint: f.hint || ""
  })).join("")}</div>`;
}

function renderIntakeChecklist(spec) {
  return `<ul class="checklist-grid">${(spec.checklist || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function renderRecordForm(code, collection) {
  return `<form class="inline-form wrap module-record-form" data-module-record-form data-module-code="${esc(code)}" data-collection-key="${esc(collection.key)}">
    ${(collection.fields || []).map((fieldDef) => `<input name="${esc(fieldDef.key)}" type="${esc(fieldDef.type || "text")}" placeholder="${esc(fieldDef.label)}" ${collection.requiredFields?.includes(fieldDef.key) ? "required" : ""} />`).join("")}
    <button type="submit">${esc(collection.addLabel || `Add ${collection.label}`)}</button>
  </form>`;
}

function renderEditableRecordCells(code, collectionKey, row, fields) {
  return fields.map((fieldDef) => `<td><input
    data-record-field="${esc(fieldDef.key)}"
    data-record-module="${esc(code)}"
    data-record-collection="${esc(collectionKey)}"
    data-record-id="${esc(row.id || "")}"
    type="${esc(fieldDef.type || "text")}"
    value="${esc(row[fieldDef.key] || "")}"
  /></td>`).join("");
}

function renderRecordTable(code, collection, rows) {
  const fields = collection.fields || [];
  const body = rows.length
    ? rows.map((row) => `<tr>${renderEditableRecordCells(code, collection.key, row, fields)}<td><button type="button" class="danger-button" data-record-delete data-record-module="${esc(code)}" data-record-collection="${esc(collection.key)}" data-record-id="${esc(row.id || "")}">Delete</button></td></tr>`).join("")
    : `<tr><td colspan="${Math.max(fields.length + 1, 1)}">No ${esc(collection.label.toLowerCase())} entered yet. This module cannot come alive until this data is captured.</td></tr>`;
  return `<div class="table-wrap compact-table"><table><thead><tr>${fields.map((fieldDef) => `<th>${esc(fieldDef.label)}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${body}</tbody></table></div>`;
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
      </div>
      ${renderScalarIntakeFields(code, spec, data)}
      ${(spec.collections || []).map((collection) => {
        const rows = Array.isArray(data[collection.key]) ? data[collection.key] : [];
        return `<section class="collection-block"><div class="row-between"><h4>${esc(collection.label)}</h4><span class="badge badge-info">${rows.length} record(s)</span></div>${renderRecordForm(code, collection)}${renderRecordTable(code, collection, rows)}</section>`;
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

function renderDocs() {
  const groups = state.documentGroups || [];
  const docs = state.documents || [];
  return `
    <h2>Document Intake + Source-of-Truth Resolver</h2>
    <p class="lead">File intake captures filename and metadata. No parser is required for launch control: the onboarder or custodian marks artifact type, term, currency, approval, and source-of-truth.</p>
    <form id="document-form" class="grid2 intake-card">
      <input id="doc-file-input" type="file" name="file" />
      <input name="title" placeholder="Document title (auto-filled from file name)" required />
      <select name="artifactType">${ARTIFACT_TYPES.map((v) => option(v, "gl_cert")).join("")}</select>
      <input name="entityAssociation" placeholder="Facility/entity association" value="Homewood Lodge ALF" />
      <input name="term" placeholder="Term/year" />
      <input name="effectiveDate" type="date" />
      <input name="expirationDate" type="date" />
      <select name="currencyStatus">${CURRENCY_STATUSES.map((v) => option(v, "unknown")).join("")}</select>
      <input name="version" placeholder="Version" value="v1" />
      <select name="custodianApprovalStatus">${APPROVAL_STATUSES.map((v) => option(v, "pending")).join("")}</select>
      <select name="confidence">${CONFIDENCE_LEVELS.map((v) => option(v, "manual")).join("")}</select>
      <input name="notes" placeholder="Confidence notes" />
      <button type="submit">Add intake row</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Document</th><th>Artifact</th><th>Facility/Entity</th><th>Term</th><th>Effective</th><th>Expiration</th><th>Version</th><th>Currency</th><th>Approval</th><th>Confidence/Notes</th><th>Route/Exception</th></tr></thead><tbody>
      ${docs.map((d) => `<tr>
        <td><strong>${esc(d.title)}</strong><br><small>${d.isSourceOfTruth ? "Source of truth" : "variant/intake"}</small></td>
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
      </tr>`).join("")}
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
      <input name="scopeType" placeholder="scopeType (document/module/rule)" required />
      <input name="scopeId" placeholder="scopeId" required />
      <input name="ownerName" placeholder="ownerName" required />
      <input name="description" placeholder="description" required />
      <select name="severity"><option>major</option><option>minor</option><option>blocking</option></select>
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
    <h2>Contradictions</h2>
    <p class="lead">Homewood rounds show the trust contract: policy text, operational reality, and app settings must be reconciled before launch.</p>
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

function renderExport() {
  return `
    <h2>Executive Export</h2>
    <p class="lead">Generate a markdown packet with launch narrative, signed gates, criteria snapshot, exceptions, source-of-truth decisions, contradictions, and recent decision log excerpts.</p>
    <button id="generate-export">Generate Readiness Export</button>
    <h3>Markdown Readiness Summary</h3>
    <textarea id="export-markdown" rows="16" placeholder="Generate export..."></textarea>
    <h3>JSON State Export</h3>
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

function renderDecisionLog() {
  decisionLogEl.innerHTML = (state.decisionLog || []).slice(0, 20).map((d) => `<li><strong>${esc(d.actionType)}</strong> — ${esc(d.summary)}</li>`).join("");
}

function render() {
  renderTabs();
  renderSummary();
  renderView();
  renderDecisionLog();
}

document.body.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    activeTab = tab.dataset.tab;
    render();
    return;
  }

  const deleteRecord = e.target.closest("[data-record-delete]");
  if (deleteRecord) {
    state = deleteModuleRecord(state, deleteRecord.dataset.recordModule, deleteRecord.dataset.recordCollection, deleteRecord.dataset.recordId);
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

document.body.addEventListener("change", (e) => {
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
    renderSummary();
    return;
  }

  const recordField = e.target.closest("[data-record-field]");
  if (recordField) {
    state = updateModuleRecord(state, recordField.dataset.recordModule, recordField.dataset.recordCollection, recordField.dataset.recordId, { [recordField.dataset.recordField]: recordField.value });
    renderSummary();
    return;
  }

  const docField = e.target.closest("[data-doc-field]");
  if (docField) {
    state = updateDocument(state, docField.dataset.docId, { [docField.dataset.docField]: docField.value });
    renderSummary();
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
    renderSummary();
    return;
  }

  if (e.target.id === "doc-file-input") {
    const title = e.target.form?.querySelector("input[name='title']");
    if (title && e.target.files?.[0]?.name && !title.value) title.value = e.target.files[0].name;
  }
});

document.body.addEventListener("submit", (e) => {
  if (e.target.matches("[data-module-record-form]")) {
    e.preventDefault();
    const fd = new FormData(e.target);
    state = addModuleRecord(state, e.target.dataset.moduleCode, e.target.dataset.collectionKey, Object.fromEntries(fd.entries()));
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
    const fd = new FormData(e.target);
    const file = fd.get("file");
    state = addDocument(state, { ...Object.fromEntries(fd.entries()), fileName: file?.name || "" });
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

resetButton.addEventListener("click", () => {
  state = resetState();
  state = appendDecisionLog(state, {
    actor: "user",
    actionType: "data_reset",
    summary: "Reset Demo triggered.",
    relatedType: "facility",
    relatedId: state.facility.id
  });
  render();
});

render();
