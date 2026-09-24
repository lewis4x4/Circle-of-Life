/**
 * Real compute/document -> service RPC integration, on a disposable native DB only.
 * PG_VERIFY_NATIVE_SOCKET must have the Codex run ownership manifest used by the
 * migration replay. The default template is the SQL lane's synthetic `packets` DB.
 * Nothing in this script connects to hosted PostgreSQL or a real user account.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPayrollSnapshot } from "../../src/lib/payroll-packets/compute";
import { buildPayrollPacketCsv, buildPayrollPacketHtml, buildPayrollPacketPdf } from "../../src/lib/payroll-packets/documents";
import type { PacketInput, PacketSnapshot, PayrollPacket, PayrollPolicy, PayrollPolicyRecord, PayrollSource } from "../../src/lib/payroll-packets/types";

const runBase = fs.realpathSync(path.join(os.homedir(), ".hermes/tmp/agent-runs"));
const socketSetting = process.env.PG_VERIFY_NATIVE_SOCKET;
assert(socketSetting, "PG_VERIFY_NATIVE_SOCKET must identify an owned native verification cluster");
const socket = fs.realpathSync(socketSetting);
assert(socket.startsWith(runBase + path.sep), "Native socket must be inside agent-runs");
const ownership = JSON.parse(fs.readFileSync(path.join(socket, "manifest.json"), "utf8"));
assert(ownership.created_by === "codex" && ownership.run_id === path.basename(socket), "Native cluster ownership must match");
const bin = process.env.PG_VERIFY_NATIVE_BIN;
assert(bin && path.isAbsolute(bin), "PG_VERIFY_NATIVE_BIN must identify installed PostgreSQL binaries");
const port = process.env.PG_VERIFY_NATIVE_PORT ?? "55493";
assert(/^\d+$/.test(port), "Native port must be numeric");
const template = process.env.PG_VERIFY_NATIVE_TEMPLATE ?? "packets";
assert(/^(packets|haven_verify_[a-z0-9_]+)$/.test(template), "Only a synthetic verification template is allowed");
const evidenceBase = fs.realpathSync(process.env.PAYROLL_PACKET_EVIDENCE_DIR ?? path.join(runBase, "payroll-packets-build-20260924"));
assert(evidenceBase.startsWith(runBase + path.sep), "Evidence must remain in agent-runs");
const runId = `local-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;
const scratch = path.join(evidenceBase, runId);
fs.mkdirSync(scratch, { mode: 0o700 });
const database = `payroll_packet_verify_${process.pid}_${Date.now()}`;
const manifestPath = path.join(scratch, "manifest.json");
const proofPath = path.join(scratch, "proof.json");
const manifest = { created_by: "codex", run_id: runId, created_at: new Date().toISOString(), purpose: "Synthetic payroll RPC/document integration", cluster_socket: socket, database, database_removed: false, paths: [manifestPath, proofPath, path.join(scratch, "approved-original.pdf"), path.join(scratch, "approved-original.html"), path.join(scratch, "approved-original.csv")] };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
const connection = ["-h", socket, "-p", port, "-U", "postgres"];
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const argument = (value: unknown): string => value == null ? "NULL" : typeof value === "number" || typeof value === "boolean" ? String(value) : typeof value === "string" ? quote(value) : `${quote(JSON.stringify(value))}::jsonb`;
const sql = (query: string) => execFileSync(path.join(bin, "psql"), [...connection, "-d", database, "-qAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trim();
const rpc = <T>(name: string, ...args: unknown[]): T => {
  assert(/^payroll_packet_(policy_save|revision|source_page|write|action)$/.test(name));
  return JSON.parse(sql(`SET ROLE service_role; SELECT to_jsonb(public.${name}(${args.map(argument).join(",")}));`)) as T;
};
const expectedFailure = (work: () => unknown, fragment: string) => {
  try { work(); } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? String(error);
    assert(stderr.includes(fragment), `Expected ${fragment}, received ${stderr}`);
    return;
  }
  throw new Error(`Expected refusal: ${fragment}`);
};
const results: Record<string, unknown> = { startedAt: new Date().toISOString(), database, template, syntheticOnly: true };
let created = false;
try {
  execFileSync(path.join(bin, "createdb"), [...connection, "-T", template, database], { stdio: "pipe" });
  created = true;
  // The template may contain the SQL lane's iterative 505 definitions. Replace
  // only these new objects in this disposable clone, then apply the exact file.
  sql(`DO $$ DECLARE t text; r record; BEGIN
    FOREACH t IN ARRAY ARRAY['time_punches','time_punch_corrections','timeclock_sync_rejections','floor_unlocks','timeclock_credentials','staff','facilities','payroll_packet_policies'] LOOP
      IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('DROP TRIGGER IF EXISTS tr_payroll_source_revision ON public.%I',t); END IF;
    END LOOP;
    FOR r IN SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('haven','public') AND p.proname LIKE 'payroll_packet_%' LOOP
      EXECUTE 'DROP FUNCTION IF EXISTS '||r.signature||' CASCADE';
    END LOOP;
  END $$;
  DROP TABLE IF EXISTS public.payroll_packet_events,public.payroll_packets,public.payroll_packet_policies,haven.payroll_packet_source_revisions CASCADE;`);
  sql(fs.readFileSync(path.join(process.cwd(), "supabase/migrations/505_payroll_packets.sql"), "utf8"));
  const org = randomUUID(), entity = randomUUID(), facility = randomUUID(), actor = randomUUID(), staff = randomUUID();
  sql(`INSERT INTO public.organizations(id,name) VALUES(${quote(org)},'Synthetic Payroll Integration');
    INSERT INTO public.entities(id,organization_id,name) VALUES(${quote(entity)},${quote(org)},'Synthetic Employer');
    INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) VALUES(${quote(facility)},${quote(org)},${quote(entity)},'Synthetic Payroll Facility','Synthetic','Synthetic','00000',1);
    INSERT INTO auth.users(id,email) VALUES(${quote(actor)},${quote(`${actor}@payroll.invalid`)});
    INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role) VALUES(${quote(actor)},${quote(org)},${quote(`${actor}@payroll.invalid`)},'Synthetic Payroll Owner','owner');
    INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) VALUES(${quote(staff)},${quote(org)},${quote(facility)},'Synthetic','Employee','resident_aide','2026-01-01');
    INSERT INTO public.timeclock_credentials(organization_id,staff_id,employee_number,pin_hash,pin_set_by) VALUES(${quote(org)},${quote(staff)},'SYNTHETIC-001','synthetic-noncredential',${quote(actor)});`);
  for (let day = 14; day <= 18; day++) for (const [kind, hour] of [["in", 13], ["out", 22]] as const) {
    sql(`INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id) VALUES(${quote(org)},${quote(facility)},${quote(staff)},${quote(kind)},${quote(`2026-09-${day}T${hour}:00:00Z`)},${quote(randomUUID())});`);
  }
  const config: PayrollPolicy = { employerName: "Synthetic Employer", payFrequency: "weekly", anchorDate: "2026-09-14", workweekDay: 1, workweekTime: "00:00", timeZone: "America/New_York", overtimeThresholdMinutes: 2400, overtimeFacilityIds: [facility], calculationMode: "automatic", mealPolicy: "punched_unpaid", roundingMinutes: 0, salaryTreatment: "unchanged", approvalRole: "central", defaultMethod: "phone", policyNote: "Synthetic approved rules: training reclassifies regular hours; holiday and personal time do not accrue overtime." };
  const policy = rpc<PayrollPolicyRecord>("payroll_packet_policy_save", actor, facility, config, true, 0);
  assert.equal(policy.updated_by_name, "Synthetic Payroll Owner");
  const source = (): PayrollSource => {
    const before = rpc<string>("payroll_packet_revision", actor, facility);
    const pageAll = <T>(kind: string): T[] => {
      const rows: T[] = [];
      for (;;) {
        // Small page size proves the actual pagination path with ten punches.
        const page = rpc<{ data: T[]; count: number }>("payroll_packet_source_page", actor, facility, kind, rows.length, 2);
        rows.push(...page.data);
        if (rows.length === page.count) return rows;
        assert(page.data.length > 0 && rows.length < page.count, "Source count/page mismatch");
      }
    };
    const data: PayrollSource = { facilityId: facility, facilityName: "Synthetic Payroll Facility", sourceRevision: before, policy, groupPolicies: [policy], people: pageAll("people"), punches: pageAll("punches"), corrections: pageAll("corrections"), rejections: pageAll("rejections"), floorUnlocks: pageAll("floorUnlocks") };
    assert.equal(rpc("payroll_packet_revision", actor, facility), before);
    assert(!JSON.stringify(data).includes("synthetic-noncredential"));
    return data;
  };
  const input: PacketInput = { staffId: staff, payrollId: "SYNTHETIC-001", payBasis: "hourly", department: "operations", regularMinutes: null, overtimeMinutes: null, holidayMinutes: 60, personalMinutes: 0, trainingMinutes: 60, onCallCents: 1250, bonusCents: 2500, salaryCents: null, note: "Synthetic payroll integration only", reason: "", reviewed: true };
  const calculate = (row: PacketInput): PacketSnapshot => buildPayrollSnapshot(source(), { periodStart: "2026-09-14", periodEnd: "2026-09-20", checkDate: "2026-09-25", inputs: [row], now: new Date() });
  const write = (snapshot: PacketSnapshot, row: PacketInput, packet: PayrollPacket | null = null, parent: PayrollPacket | null = null) => rpc<PayrollPacket>("payroll_packet_write", actor, facility, packet?.id ?? null, packet?.revision ?? 0, snapshot.sourceRevision, policy.revision, snapshot.periodStart, snapshot.periodEnd, snapshot.checkDate, [row], snapshot, packet?.amends_packet_id ?? parent?.id ?? null, parent ? "Synthetic bonus correction" : null);
  const action = (packet: PayrollPacket, name: string, detail: object) => rpc<PayrollPacket>("payroll_packet_action", actor, packet.id, packet.revision, name, detail);
  const documents = (packet: PayrollPacket) => {
    const approvedAt = new Date().toISOString();
    const approved: PayrollPacket = { ...packet, status: "approved", approved_at: approvedAt, approved_by: actor, approved_by_name: "Synthetic Payroll Owner" };
    const pdf = buildPayrollPacketPdf(approved), html = buildPayrollPacketHtml(approved), csv = buildPayrollPacketCsv(approved);
    assert(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) && html.includes("Synthetic Payroll Owner") && csv.includes("SYNTHETIC-001"));
    return { pdfBase64: pdf.toString("base64"), html, csv, approvedAt, approvedByName: approved.approved_by_name, documentHash: createHash("sha256").update(pdf).digest("hex") };
  };
  let snapshot = calculate(input);
  assert.deepEqual(snapshot.blockers, []);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.totals.workedMinutes, 2700);
  assert.equal(snapshot.totals.regularMinutes, 2340);
  assert.equal(snapshot.totals.overtimeMinutes, 300);
  assert.equal(snapshot.totals.paidMinutes, 2760);
  let packet = write(snapshot, input);
  assert.equal(packet.created_by_name, "Synthetic Payroll Owner");
  sql(`UPDATE public.staff SET first_name='Synthetic Updated' WHERE id=${quote(staff)};`);
  expectedFailure(() => action(packet, "approve", documents(packet)), "payroll_source_stale");
  snapshot = calculate(input);
  assert.deepEqual(snapshot.blockers, []);
  packet = write(snapshot, input, packet);
  const original = documents(packet);
  packet = action(packet, "approve", original);
  packet = action(packet, "report", { method: "phone", reference: "Synthetic phone confirmation" });
  packet = action(packet, "difference", { note: "Synthetic preview discrepancy recorded and corrected" });
  packet = action(packet, "reconcile", { matches: true, note: "Synthetic ADP preview matches all rows and categories" });
  assert.equal(packet.status, "reconciled");
  assert.equal(packet.reported_by_name, "Synthetic Payroll Owner");
  assert.equal(packet.reconciled_by_name, "Synthetic Payroll Owner");
  const amendmentInput = { ...input, bonusCents: 3500, reviewed: false };
  const amendmentSnapshot = calculate(amendmentInput);
  assert(amendmentSnapshot.blockers.some((message) => message.includes("Review this employee")));
  let amendment = write(amendmentSnapshot, amendmentInput, null, packet);
  assert.equal(amendment.version, 2);
  expectedFailure(() => action(amendment, "approve", documents(amendment)), "payroll_approval_blocked");
  amendmentInput.reviewed = true;
  const reviewedSnapshot = calculate(amendmentInput);
  assert.deepEqual(reviewedSnapshot.blockers, []);
  amendment = write(reviewedSnapshot, amendmentInput, amendment);
  amendment = action(amendment, "approve", documents(amendment));
  amendment = action(amendment, "report", { method: "run", reference: "Synthetic RUN entry confirmation" });
  assert.equal(amendment.status, "reported");
  const stored = JSON.parse(sql(`SELECT jsonb_build_object('pdfBase64',approved_pdf_base64,'html',approved_html,'csv',approved_csv,'documentHash',document_hash,'status',status) FROM public.payroll_packets WHERE id=${quote(packet.id)};`));
  for (const key of ["pdfBase64", "html", "csv", "documentHash"] as const) assert.equal(stored[key], original[key], `Original ${key} changed`);
  assert.equal(stored.status, "reconciled");
  assert.equal(createHash("sha256").update(Buffer.from(stored.pdfBase64, "base64")).digest("hex"), stored.documentHash);
  const events = JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'actorName',actor_name) ORDER BY created_at,id),'[]') FROM public.payroll_packet_events WHERE packet_id=${quote(packet.id)};`)) as Array<{ action: string; actorName: string }>;
  assert.deepEqual(events.map((event) => event.action), ["create", "edit", "approve", "report", "difference", "reconcile"]);
  assert(events.every((event) => event.actorName === "Synthetic Payroll Owner"));
  fs.writeFileSync(path.join(scratch, "approved-original.pdf"), Buffer.from(original.pdfBase64, "base64"), { mode: 0o600 });
  fs.writeFileSync(path.join(scratch, "approved-original.html"), original.html, { mode: 0o600 });
  fs.writeFileSync(path.join(scratch, "approved-original.csv"), original.csv, { mode: 0o600 });
  Object.assign(results, { status: "pass", checks: ["paginated RPC source to real compute", "45 worked hours split into regular and overtime", "training reclassification and holiday/dollar separation", "stale source approval refused", "real PDF/HTML/CSV approval persisted", "phone handoff with difference and reconciliation", "amendment requires renewed review", "RUN amendment handoff", "original document bytes and SHA256 retained", "historical actor names retained"], totals: snapshot.totals, originalStatus: packet.status, amendmentStatus: amendment.status, originalDocumentHash: original.documentHash, pdfBytes: Buffer.from(original.pdfBase64, "base64").length, eventActions: events.map((event) => event.action) });
} catch (error) {
  Object.assign(results, { status: "fail", error: error instanceof Error ? error.message : String(error) });
  throw error;
} finally {
  if (created) {
    execFileSync(path.join(bin, "dropdb"), [...connection, database], { stdio: "pipe" });
    manifest.database_removed = true;
  }
  Object.assign(results, { finishedAt: new Date().toISOString(), databaseRemoved: manifest.database_removed });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  fs.writeFileSync(proofPath, JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: results.status, proof: proofPath, databaseRemoved: manifest.database_removed, checks: results.checks }));
}
