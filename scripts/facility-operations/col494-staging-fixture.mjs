#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TARGET = "iwcnajanvjvynolltflw";
const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";
const HOMEWOOD = "00000000-0000-0000-0002-000000000003";
const CONFIG = path.join(os.homedir(), ".config/haven-staging/col217.env");
const action = process.argv[2];
const stateArg = process.argv.indexOf("--state");
const statePath = stateArg >= 0 ? path.resolve(process.argv[stateArg + 1] ?? "") : "";
if (!["setup", "refresh", "cleanup"].includes(action) || !statePath) {
  throw new Error("Usage: col494-staging-fixture.mjs <setup|refresh|cleanup> --state <private absolute path>");
}

function requireFact(value, message) {
  if (!value) throw new Error(message);
}
function parseEnv(file) {
  const mode = fs.statSync(file).mode & 0o777;
  requireFact((mode & 0o077) === 0, "Private staging config permissions changed");
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line && !line.trimStart().startsWith("#") && line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}
const env = parseEnv(CONFIG);
requireFact(env.STAGING_PROJECT_REF === TARGET, "Wrong staging project ref");
requireFact(env.NEXT_PUBLIC_SUPABASE_URL === `https://${TARGET}.supabase.co`, "Wrong staging API target");
requireFact(env.PGUSER === `postgres.${TARGET}`, "Wrong staging database user");
requireFact(fs.readFileSync(path.join(os.homedir(), ".config/haven-staging/control/supabase/.temp/project-ref"), "utf8").trim() === TARGET, "Dedicated CLI target changed");

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/operations/activity-catalog.json"), "utf8"));
const allEntries = catalog.entries;
const allComponents = allEntries.flatMap((entry) => entry.components.map((component) => ({ ...component, sourceId: entry.sourceId, sourceText: entry.sourceText, questionIds: entry.questionIds, confirmationReason: entry.confirmationReason })));
const entries = catalog.entries.filter((entry) => /^AL-(D|W)/.test(entry.sourceId));
const components = entries.flatMap((entry) => entry.components.map((component) => ({ ...component, sourceId: entry.sourceId, sourceText: entry.sourceText, questionIds: entry.questionIds, confirmationReason: entry.confirmationReason })));
requireFact(entries.length === 27 && components.length === 35, "Daily/Weekly canonical inventory changed");
requireFact(allEntries.length === 91 && allComponents.length === 110, "Complete canonical inventory changed");

const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
function uuid() { return crypto.randomUUID(); }
function secret() { return crypto.randomBytes(32).toString("base64url"); }
function facilityDate(instant = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday.toLowerCase() };
}
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "w", 0o600);
  fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
  fs.closeSync(fd);
  fs.chmodSync(file, 0o600);
}
function psql(sql) {
  const result = spawnSync("/opt/homebrew/opt/postgresql@17/bin/psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: { ...process.env, ...env, PGPASSWORD: env.SUPABASE_DB_PASSWORD }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const log = path.join(path.dirname(statePath), "fixture-sql-error.log");
    fs.writeFileSync(log, result.stderr, { mode: 0o600 });
    fs.chmodSync(log, 0o600);
    throw new Error(`Staging SQL failed (${result.status}): ${result.stderr.split(/\r?\n/).filter(Boolean)[0] ?? "inspect private log"}`);
  }
  return result.stdout.trim();
}
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.code ?? "error"} ${error.message}`);
  return data;
}
async function login(email, password) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Synthetic login failed: ${error?.message ?? "no session"}`);
  return { client, session: data.session };
}
function sourceSubject(component, state) {
  if (component.subjectKind === "resident") return state.ids.residentSubject;
  if (component.subjectKind === "employee") return state.ids.employeeSubject;
  if (component.subjectKind === "asset") {
    if (component.key === "hfo-al-w01-01") return state.ids.generatorSubject;
    if (component.key === "hfo-al-w01-02") return state.ids.coSubject;
    return state.ids.aedSubject;
  }
  return state.ids.facilitySubject;
}
function requirementPayload(component) {
  const payload = {
    title: `COL494 Synthetic · ${component.label}`,
    wording: `Synthetic engineering proof for ${component.sourceId}; no Homewood operating rule is approved by this fixture.`,
    procedure: "Use the existing Haven task, source context, evidence, issue and history surfaces. Record only synthetic fixture work.",
    allowed_recorder_roles: ["owner", "facility_admin", "manager"],
    subject_kind: component.subjectKind,
  };
  if (component.key === "hfo-al-d03-01") payload.required_evidence = [{ kind: "photo", label: "Synthetic mail-room evidence", min_count: 1, when: "always" }];
  return payload;
}
async function createUser(state, name, role) {
  if (state.users[name]) return;
  const email = `${state.run}-${name}@example.invalid`;
  const password = secret();
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `COL494 Synthetic ${name}` } });
  if (error || !data.user) throw new Error(`Could not create ${name}: ${error?.message ?? "no user"}`);
  state.users[name] = { id: data.user.id, email, password, role };
  writePrivate(statePath, state);
}

async function setup() {
  const existing = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
  requireFact(!existing || (existing.target === TARGET && existing.setupComplete === false && existing.cleaned === false), "Existing fixture state requires refresh, cleanup, or exact inspection");
  const state = existing ?? {
    run: `col494-${crypto.randomBytes(6).toString("hex")}`,
    target: TARGET,
    sourceSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    createdAt: new Date().toISOString(),
    ids: {
      org: uuid(), entity: uuid(), site: uuid(), otherSite: uuid(), resident: uuid(), employee: uuid(),
      facilitySubject: uuid(), otherFacilitySubject: uuid(), residentSubject: uuid(), employeeSubject: uuid(),
      generator: uuid(), generatorSubject: uuid(), coDetector: uuid(), coSubject: uuid(), aed: uuid(), aedSubject: uuid(),
      census: uuid(), dailyLog: uuid(), vital: uuid(),
    },
    users: {}, activities: {}, sourceItems: {}, requirements: {}, facilityRequirements: {}, bindings: {}, tasks: {}, sessions: {}, coreInserted: false, setupComplete: false, cleaned: false,
  };
  writePrivate(statePath, state);
  await createUser(state, "owner", "owner");
  await createUser(state, "admin", "facility_admin");
  await createUser(state, "otherAdmin", "facility_admin");
  await createUser(state, "manager", "manager");
  await createUser(state, "profileOwner", "owner");
  for (const component of allComponents) state.activities[component.key] ??= uuid();
  state.sourceItems ??= {};
  for (const entry of allEntries) state.sourceItems[entry.sourceId] ??= uuid();
  state.requirements ??= {};
  state.facilityRequirements ??= {};
  state.bindings ??= {};
  state.coreInserted ??= false;
  writePrivate(statePath, state);

  const values = state.ids;
  const profiles = Object.entries(state.users).filter(([name]) => name !== "profileOwner").map(([name, user]) => `(${sqlText(user.id)},${sqlText(user.email)},${sqlText(`COL494 Synthetic ${name}`)},${sqlText(user.role)}::public.app_role,${sqlText(values.org)},true)`).join(",");
  const access = [
    ["owner", "site"], ["owner", "otherSite"], ["admin", "site"], ["otherAdmin", "otherSite"], ["manager", "site"],
  ].map(([user, site]) => `(${sqlText(state.users[user].id)},${sqlText(values[site])},${sqlText(values.org)},${sqlText(state.users.owner.id)})`).join(",");
  const subjects = [
    [values.facilitySubject, values.site, "facility", null, null, null], [values.otherFacilitySubject, values.otherSite, "facility", null, null, null],
    [values.residentSubject, values.site, "resident", values.resident, null, null], [values.employeeSubject, values.site, "employee", null, values.employee, null],
    [values.generatorSubject, values.site, "asset", null, null, values.generator], [values.coSubject, values.site, "asset", null, null, values.coDetector], [values.aedSubject, values.site, "asset", null, null, values.aed],
  ].map(([id, site, kind, resident, employee, asset]) => `(${sqlText(id)},${sqlText(values.org)},${sqlText(site)},${sqlText(kind)},${resident ? sqlText(resident) : "NULL"},${employee ? sqlText(employee) : "NULL"},${asset ? sqlText(asset) : "NULL"})`).join(",");
  const activityRows = allComponents.map((component) => `(${sqlText(state.activities[component.key])},${sqlText(values.org)},NULL,${sqlText(component.key)},${sqlText(`COL494 Synthetic · ${component.label}`)},${sqlText(component.kind)},${component.subjectKind ? sqlText(component.subjectKind) : "NULL"},'admin_log')`).join(",");
  const sourceRows = allEntries.map((entry) => `SELECT ${sqlText(state.sourceItems[entry.sourceId])}::uuid,${sqlText(values.org)}::uuid,source_item_id,intake_version,source_file,source_sha256,source_payload,status FROM public.operation_activity_source_items WHERE organization_id=${sqlText(DEFAULT_ORG)} AND source_item_id=${sqlText(entry.sourceId)}`).join(" UNION ALL ");
  const mappings = allComponents.map((component) => `(${sqlText(uuid())},${sqlText(values.org)},${sqlText(state.sourceItems[component.sourceId])},${sqlText(state.activities[component.key])})`).join(",");
  if (!state.coreInserted) {
    const existingOrg = Number(psql(`SELECT count(*) FROM public.organizations WHERE id=${sqlText(values.org)}`));
    if (existingOrg === 0) psql(`BEGIN;
INSERT INTO public.organizations(id,name) VALUES(${sqlText(values.org)},${sqlText(state.run)});
INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES(${sqlText(values.entity)},${sqlText(values.org)},${sqlText(state.run)},'llc');
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) VALUES
 (${sqlText(values.site)},${sqlText(values.org)},${sqlText(values.entity)},'COL494 Synthetic Homewood-shaped Site','Synthetic','Test','00000',20,'America/New_York'),
 (${sqlText(values.otherSite)},${sqlText(values.org)},${sqlText(values.entity)},'COL494 Synthetic Other Site','Synthetic','Test','00000',20,'America/New_York');
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) VALUES ${profiles}
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) VALUES(${sqlText(state.users.profileOwner.id)},${sqlText(state.users.profileOwner.email)},'COL494 Synthetic profile owner','owner',${sqlText(DEFAULT_ORG)},true)
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES ${access};
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES(${sqlText(state.users.profileOwner.id)},${sqlText(HOMEWOOD)},${sqlText(DEFAULT_ORG)},${sqlText(state.users.profileOwner.id)});
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) VALUES
 (${sqlText(values.org)},${sqlText(values.site)},${sqlText(state.users.owner.id)},'resident',${sqlText(state.users.owner.id)},'COL494 synthetic proof',true),
 (${sqlText(values.org)},${sqlText(values.site)},${sqlText(state.users.owner.id)},'employee_personnel',${sqlText(state.users.owner.id)},'COL494 synthetic proof',true),
 (${sqlText(values.org)},${sqlText(values.site)},${sqlText(state.users.owner.id)},'financial',${sqlText(state.users.owner.id)},'COL494 synthetic proof',true),
 (${sqlText(values.org)},${sqlText(values.site)},${sqlText(state.users.admin.id)},'resident',${sqlText(state.users.owner.id)},'COL494 synthetic proof',true),
 (${sqlText(values.org)},${sqlText(values.site)},${sqlText(state.users.admin.id)},'employee_personnel',${sqlText(state.users.owner.id)},'COL494 synthetic proof',true),
 (${sqlText(values.org)},${sqlText(values.site)},${sqlText(state.users.admin.id)},'financial',${sqlText(state.users.owner.id)},'COL494 synthetic proof',true);
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) VALUES(${sqlText(values.resident)},${sqlText(values.org)},${sqlText(values.site)},'Synthetic','Resident','1940-01-01','female','active');
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date,employment_status) VALUES(${sqlText(values.employee)},${sqlText(values.org)},${sqlText(values.site)},'Synthetic','Employee','resident_aide',current_date,'active');
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name,status) VALUES
 (${sqlText(values.generator)},${sqlText(values.org)},${sqlText(values.site)},'generator','Synthetic generator','active'),
 (${sqlText(values.coDetector)},${sqlText(values.org)},${sqlText(values.site)},'other','Synthetic carbon monoxide detector','active'),
 (${sqlText(values.aed)},${sqlText(values.org)},${sqlText(values.site)},'aed','Synthetic AED','active');
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id,employee_id,asset_id) VALUES ${subjects};
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin) VALUES ${activityRows};
INSERT INTO public.operation_activity_source_items(id,organization_id,source_item_id,intake_version,source_file,source_sha256,source_payload,status) ${sourceRows};
INSERT INTO public.operation_activity_source_mappings(id,organization_id,source_item_id,activity_id) VALUES ${mappings};
INSERT INTO public.operation_source_adapters(id,organization_id,source_key,subject_kind,reader_function,status,note) VALUES
 (${sqlText(uuid())},${sqlText(values.org)},'asset-observation','asset','operation_source_read_asset_observation','registered','COL494 synthetic fixture only');
INSERT INTO public.operation_source_rules(id,organization_id,source_key,activity_id,status) VALUES
 (${sqlText(uuid())},${sqlText(values.org)},'asset-observation',${sqlText(state.activities['hfo-al-w01-01'])},'registered'),
 (${sqlText(uuid())},${sqlText(values.org)},'asset-observation',${sqlText(state.activities['hfo-al-w01-02'])},'registered');
INSERT INTO public.census_daily_log(id,facility_id,organization_id,log_date,total_licensed_beds,occupied_beds,available_beds,hold_beds,maintenance_beds,occupancy_rate)
 VALUES(${sqlText(values.census)},${sqlText(values.site)},${sqlText(values.org)},current_date,20,10,10,0,0,0.5);
INSERT INTO public.daily_logs(id,resident_id,facility_id,organization_id,log_date,shift,logged_by,general_notes,created_by)
 VALUES(${sqlText(values.dailyLog)},${sqlText(values.resident)},${sqlText(values.site)},${sqlText(values.org)},current_date,'day',${sqlText(state.users.admin.id)},'Synthetic daily log',${sqlText(state.users.admin.id)});
INSERT INTO public.daily_vital_observations(id,daily_log_id,resident_id,facility_id,organization_id,observed_at,measurements,recorded_by)
 VALUES(${sqlText(values.vital)},${sqlText(values.dailyLog)},${sqlText(values.resident)},${sqlText(values.site)},${sqlText(values.org)},clock_timestamp()-interval '1 hour','{"temperature_f":98.4,"oxygen_saturation_pct":97}'::jsonb,${sqlText(state.users.admin.id)});
COMMIT;`);
    else requireFact(existingOrg === 1 && Number(psql(`SELECT count(*) FROM public.operation_activities WHERE organization_id=${sqlText(values.org)}`)) === allComponents.length, "Partial core fixture requires exact inspection");
    state.coreInserted = true;
    writePrivate(statePath, state);
  }

  const logged = {};
  for (const [name, user] of Object.entries(state.users)) logged[name] = await login(user.email, user.password);
  for (const [name, value] of Object.entries(logged)) state.sessions[name] = value.session;
  writePrivate(statePath, state);

  for (const component of components) {
    if (component.subjectKind === null) continue;
    const scheduledSource = ["hfo-al-w01-01", "hfo-al-w01-02"].includes(component.key);
    const date = facilityDate();
    const scheduleRule = { rule_version: 1, timezone: "America/New_York", recurrence: { kind: "weekly", weekday: date.weekday }, deadline: { time: "23:59" } };
    if (!state.requirements[component.key]) {
      const version = await rpc(logged.owner.client, "save_operation_requirement_draft_review", { p_activity_id: state.activities[component.key], p_payload: requirementPayload(component) });
      await rpc(logged.owner.client, "publish_operation_requirement_review", { p_draft_id: version.id, p_effective_from: new Date(Date.now() - 60_000).toISOString() });
      state.requirements[component.key] = version.id;
      writePrivate(statePath, state);
    }
    if (!state.facilityRequirements[component.key]) {
      const facility = await rpc(logged.admin.client, "save_operation_facility_requirement_draft_review", {
        p_activity_id: state.activities[component.key], p_facility_id: values.site,
        p_payload: { applicability: "applicable", requirement_version_id: state.requirements[component.key], schedule_status: scheduledSource ? "confirmed" : "needs_confirmation", ...(scheduledSource ? { schedule_rule: scheduleRule } : {}) },
      });
      await rpc(logged.admin.client, "publish_operation_facility_requirement_review", { p_draft_id: facility.id, p_effective_from: new Date(Date.now() - 30_000).toISOString() });
      state.facilityRequirements[component.key] = facility.id;
      writePrivate(statePath, state);
    }
    if (!state.tasks[component.key]) {
      if (scheduledSource) {
        if (!state.bindings[component.key]) {
          const binding = await rpc(logged.admin.client, "enroll_operation_binding_review", { p_activity: state.activities[component.key], p_facility: values.site, p_subject: sourceSubject(component, state), p_authority_class: "asset", p_shift: null, p_provenance: { source: "admin_log", reason: "Synthetic COL494 source matching only" }, p_effective_from: new Date(Date.now() - 10_000).toISOString() });
          state.bindings[component.key] = binding.id ?? binding.binding?.id;
          writePrivate(statePath, state);
        }
        const due = new Date(Date.now() + 60 * 60_000).toISOString();
        const generated = await rpc(service, "generate_operation_occurrences_service", { p_facility: values.site, p_configuration: state.facilityRequirements[component.key], p_occurrences: [{ occurrence_date: date.iso, period: { start_date: date.iso, end_date: date.iso }, due_at: due, grace_ends_at: null, remind_at: null, timezone: "America/New_York", adjustments: [] }], p_run: { run_id: `col494-${component.key}`, evaluator_version: "hfo-evaluator/1", date_from: date.iso, date_to: date.iso, rule: scheduleRule, occurrence_kind: "scheduled" } });
        requireFact(Number(generated.counts?.created) === 1, `Scheduled source occurrence was not created for ${component.key}`);
        state.tasks[component.key] = psql(`SELECT id FROM public.operation_task_instances WHERE organization_id=${sqlText(values.org)} AND activity_id=${sqlText(state.activities[component.key])} AND subject_id=${sqlText(sourceSubject(component, state))} AND assigned_shift_date=${sqlText(date.iso)} ORDER BY created_at DESC LIMIT 1`);
      } else {
        const occurrence = await rpc(logged.admin.client, "create_operation_manual_occurrence_review", {
          p_activity: state.activities[component.key], p_facility: values.site, p_subject: sourceSubject(component, state),
          p_request_key: `col494-${component.key}-${crypto.randomBytes(4).toString("hex")}`,
          p_payload: { note: "Synthetic manual occurrence; schedule deliberately remains unconfirmed" },
        });
        state.tasks[component.key] = occurrence.id ?? occurrence.occurrence?.id;
      }
    }
    requireFact(state.tasks[component.key], `No task returned for ${component.key}`);
    writePrivate(statePath, state);
  }

  const activity = state.activities["hfo-al-d03-01"];
  state.help ??= {};
  if (!state.help.help) {
    const help = await rpc(logged.owner.client, "write_operation_help_handover_review", {
      p_activity_id: activity, p_facility_id: values.site, p_command: "help", p_request_key: `col494-help-${crypto.randomBytes(4).toString("hex")}`, p_expected_id: null,
      p_payload: { how_to: "Check the synthetic mail location, record exceptions, and do not include resident correspondence.", examples: "No mail received; mail delivered with an exception issue.", contact: "Synthetic facility manager" },
    });
    state.help.help = help.event.id;
    writePrivate(statePath, state);
  }
  if (!state.help.proposal) {
    const proposal = await rpc(logged.owner.client, "write_operation_help_handover_review", {
      p_activity_id: activity, p_facility_id: values.site, p_command: "propose", p_request_key: `col494-duty-${crypto.randomBytes(4).toString("hex")}`, p_expected_id: null,
      p_payload: { duty_scope: "Synthetic Daily mail check", owner_user_id: state.users.admin.id, backup_user_id: state.users.manager.id, effective_at: new Date(Date.now() - 10_000).toISOString(), note: "Synthetic owner and absence cover for engineering proof" },
    });
    state.help.proposal = proposal.event.id;
    state.help.latest = proposal.event.id;
    writePrivate(statePath, state);
  }
  if (!state.help.ownerAccepted) {
    const ownerAccept = await rpc(logged.admin.client, "write_operation_help_handover_review", {
      p_activity_id: activity, p_facility_id: values.site, p_command: "accept", p_request_key: `col494-owner-${crypto.randomBytes(4).toString("hex")}`, p_expected_id: state.help.latest,
      p_payload: { proposal_id: state.help.proposal, duty_role: "owner" },
    });
    state.help.ownerAccepted = ownerAccept.event.id;
    state.help.latest = ownerAccept.event.id;
    writePrivate(statePath, state);
  }
  if (!state.help.backupAccepted) {
    const backupAccept = await rpc(logged.manager.client, "write_operation_help_handover_review", {
      p_activity_id: activity, p_facility_id: values.site, p_command: "accept", p_request_key: `col494-backup-${crypto.randomBytes(4).toString("hex")}`, p_expected_id: state.help.latest,
      p_payload: { proposal_id: state.help.proposal, duty_role: "backup" },
    });
    state.help.backupAccepted = backupAccept.event.id;
    state.help.latest = backupAccept.event.id;
    writePrivate(statePath, state);
  }
  state.setupComplete = true;
  writePrivate(statePath, state);
  console.log(JSON.stringify({ result: "PASS", target: state.target, sourceSha: state.sourceSha, run: state.run, catalogSourceRows: allEntries.length, catalogComponents: allComponents.length, demonstratedSourceRows: entries.length, demonstratedComponents: components.length, tasks: Object.keys(state.tasks).length, unresolvedWithoutTask: ["hfo-al-d15-01"], statePath }));
}

async function refresh() {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  requireFact(state.target === TARGET && state.setupComplete && !state.cleaned, "Fixture is not refreshable");
  for (const [name, user] of Object.entries(state.users)) state.sessions[name] = (await login(user.email, user.password)).session;
  writePrivate(statePath, state);
  console.log(JSON.stringify({ result: "PASS", refreshed: Object.keys(state.sessions).length, statePath }));
}

async function cleanup() {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  requireFact((fs.statSync(statePath).mode & 0o077) === 0, "Private fixture state permissions changed");
  requireFact(state.target === TARGET && typeof state.run === "string" && state.run.startsWith("col494-") && !state.cleaned, "Wrong or already retired fixture");
  requireFact(["owner", "admin", "otherAdmin", "manager", "profileOwner"].every((name) => state.users?.[name]?.id && state.users[name]?.email === `${state.run}-${name}@example.invalid`), "Synthetic user provenance changed");
  const before = JSON.parse(psql(`SELECT json_build_object(
    'organization_name',(SELECT name FROM public.organizations WHERE id=${sqlText(state.ids.org)}),
    'synthetic_profile_count',(SELECT count(*) FROM public.user_profiles WHERE id IN(${Object.values(state.users).map((user) => sqlText(user.id)).join(",")})),
    'foreign_fixture_email_count',(SELECT count(*) FROM public.user_profiles WHERE id IN(${Object.values(state.users).map((user) => sqlText(user.id)).join(",")}) AND email NOT LIKE ${sqlText(`${state.run}-%@example.invalid`)})
  )`));
  requireFact(before.organization_name === state.run && before.synthetic_profile_count === 5 && before.foreign_fixture_email_count === 0, "Fixture database provenance changed");
  for (const user of Object.values(state.users)) {
    const { error } = await service.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    if (error) throw new Error(`Could not ban fixture user: ${error.message}`);
  }
  const ids = Object.values(state.users).map((user) => sqlText(user.id)).join(",");
  psql(`BEGIN;
UPDATE public.operation_subject_access SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id=${sqlText(state.ids.org)};
UPDATE public.user_facility_access SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE user_id IN(${ids});
UPDATE public.user_profiles SET is_active=false WHERE id IN(${ids});
UPDATE public.facilities SET deleted_at=coalesce(deleted_at,clock_timestamp()) WHERE organization_id=${sqlText(state.ids.org)};
UPDATE public.entities SET deleted_at=coalesce(deleted_at,clock_timestamp()) WHERE organization_id=${sqlText(state.ids.org)};
UPDATE public.organizations SET deleted_at=coalesce(deleted_at,clock_timestamp()) WHERE id=${sqlText(state.ids.org)};
COMMIT;`);
  const facts = JSON.parse(psql(`SELECT json_build_object(
    'active_profiles',(SELECT count(*) FROM public.user_profiles WHERE id IN(${ids}) AND is_active),
    'active_site_grants',(SELECT count(*) FROM public.user_facility_access WHERE user_id IN(${ids}) AND revoked_at IS NULL),
    'active_subject_grants',(SELECT count(*) FROM public.operation_subject_access WHERE organization_id=${sqlText(state.ids.org)} AND revoked_at IS NULL),
    'active_sites',(SELECT count(*) FROM public.facilities WHERE organization_id=${sqlText(state.ids.org)} AND deleted_at IS NULL),
    'org_retired',(SELECT deleted_at IS NOT NULL FROM public.organizations WHERE id=${sqlText(state.ids.org)})
  )`));
  requireFact(facts.active_profiles === 0 && facts.active_site_grants === 0 && facts.active_subject_grants === 0 && facts.active_sites === 0 && facts.org_retired === true, "Fixture retirement incomplete");
  state.cleaned = true;
  state.cleanedAt = new Date().toISOString();
  state.cleanupTargetIds = { organizationId: state.ids.org, facilityIds: [state.ids.site, state.ids.otherSite], userIds: Object.values(state.users).map((user) => user.id) };
  state.cleanupFacts = facts;
  for (const user of Object.values(state.users)) delete user.password;
  state.sessions = {};
  writePrivate(statePath, state);
  console.log(JSON.stringify({ result: "PASS", retainedSyntheticHistory: true, facts, statePath }));
}

if (action === "setup") await setup();
if (action === "refresh") await refresh();
if (action === "cleanup") await cleanup();
