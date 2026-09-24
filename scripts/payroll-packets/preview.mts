// Actual components/calculation/documents; explicitly synthetic persistence. No hosted access.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { buildPayrollSnapshot } from "../../src/lib/payroll-packets/compute";
import { buildPayrollPacketHtml, buildPayrollPacketPdf, buildPayrollPacketCsv } from "../../src/lib/payroll-packets/documents";
import type { PacketInput, PayrollPacket, PayrollPolicy, PayrollSource, PacketEvent } from "../../src/lib/payroll-packets/types";

const root = process.cwd(), here = path.join(root, "scripts/payroll-packets"), run = process.env.PAYROLL_RUN_DIR;
if (!run?.includes("/.hermes/tmp/agent-runs/")) throw new Error("Run-owned scratch path required");
const facilityId = "11111111-1111-4111-8111-111111111111", actorId = "44444444-4444-4444-8444-444444444444", org = "55555555-5555-4555-8555-555555555555";
const config: PayrollPolicy = { employerName: "Synthetic employer", payFrequency: "weekly", anchorDate: "2026-09-14", workweekDay: 1, workweekTime: "00:00", timeZone: "America/New_York", overtimeThresholdMinutes: 2400, overtimeFacilityIds: [facilityId], calculationMode: "reviewed", mealPolicy: "punched_unpaid", roundingMinutes: 0, salaryTreatment: "unchanged", approvalRole: "central", defaultMethod: "phone", policyNote: "Synthetic reviewed payroll policy for browser verification" };
const source: PayrollSource = { facilityId, facilityName: "Synthetic test building", sourceRevision: "1", policy: { facility_id: facilityId, organization_id: org, revision: 1, config, confirmed_at: "2026-09-21T12:00:00Z", confirmed_by: actorId, updated_at: "2026-09-21T12:00:00Z" }, groupPolicies: [], people: ["A", "B"].map((letter, index) => ({ id: `22222222-2222-4222-8222-22222222222${index}`, name: `Synthetic Employee ${letter}`, role: index ? "administrator" : "resident_aide", facilityId, employmentStatus: "active", userId: null, employeeNumber: `T-00${index + 1}` })), punches: [], corrections: [], rejections: [], floorUnlocks: [] };
const packets = new Map<string, PayrollPacket>(), events: PacketEvent[] = [], documents = new Map<string, { pdf: Buffer; html: string; csv: string }>();
function rowInputs(): PacketInput[] { return source.people.map((person, i) => ({ staffId: person.id, payrollId: person.employeeNumber!, payBasis: i ? "salary" : "hourly", department: i ? "administration" : "operations", regularMinutes: i ? null : 2400, overtimeMinutes: i ? null : 0, holidayMinutes: 0, personalMinutes: 0, trainingMinutes: 0, onCallCents: 0, bonusCents: i ? 0 : 2500, salaryCents: null, note: "Synthetic source", reason: "Reviewed synthetic attendance", reviewed: false })); }
function makePacket(dates: { periodStart: string; periodEnd: string; checkDate: string }, original?: PayrollPacket, reason?: string) {
  const id = randomUUID(), now = new Date().toISOString(), inputs = original ? original.inputs.map(row => ({ ...row, reviewed: false })) : rowInputs();
  const packet: PayrollPacket = { id, root_id: original?.root_id ?? id, amends_packet_id: original?.id ?? null, version: (original?.version ?? 0) + 1, revision: 1, organization_id: org, facility_id: facilityId, period_start: dates.periodStart, period_end: dates.periodEnd, check_date: dates.checkDate, status: "draft", inputs, snapshot: buildPayrollSnapshot(source, { ...dates, inputs, now: new Date() }), source_revision: "1", policy_revision: 1, created_at: now, created_by: actorId, created_by_name: "Synthetic operator", updated_at: now, approved_at: null, approved_by: null, approved_by_name: null, document_hash: null, reported_at: null, reported_by: null, report_method: null, report_reference: null, reconciled_at: null, reconciled_by: null, reconciliation_note: null, amendment_reason: reason ?? null };
  packets.set(id, packet); return packet;
}
const first = makePacket({ periodStart: "2026-09-14", periodEnd: "2026-09-20", checkDate: "2026-09-25" });
const server = await createServer({ root: here, configFile: false, define: { "process.env": {} }, cacheDir: path.join(run, "vite-cache"), plugins: [react(), { name: "synthetic-payroll-api", configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1:8949");
    if (!url.pathname.startsWith("/api/admin/payroll-packets") && url.pathname !== "/__proof") return next();
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "application/json");
    const reply = (value: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      if (url.pathname === "/__proof") return reply({ packets: [...packets.values()], events, firstId: first.id, artifactHashes: Object.fromEntries([...documents].map(([id, doc]) => [id, createHash("sha256").update(doc.pdf).digest("hex")])) });
      const scenario = new URL(req.headers.referer ?? "http://localhost").searchParams.get("scenario");
      if (scenario === "error") return reply({ error: "Synthetic source unavailable" }, 503);
      let body: Record<string, unknown> = {};
      if (["POST", "PATCH", "PUT"].includes(req.method ?? "")) { let text = ""; for await (const chunk of req) text += chunk; body = JSON.parse(text); }
      if (url.pathname.endsWith("/policy")) {
        if (req.method === "PUT") source.policy = { ...source.policy!, config: body.config as PayrollPolicy, confirmed_at: body.confirm ? new Date().toISOString() : null, confirmed_by: body.confirm ? actorId : null, revision: source.policy!.revision + 1 };
        return reply({ policy: source.policy });
      }
      const parts = url.pathname.split("/"); const id = parts[4];
      if (!id) {
        if (req.method === "POST") return reply({ packet: makePacket(body as unknown as Parameters<typeof makePacket>[0]) }, 201);
        return reply({ packets: [...packets.values()], policy: scenario === "missing-rules" ? null : source.policy, facilities: [{ id: facilityId, name: source.facilityName }], canConfigure: true });
      }
      const packet = packets.get(id); if (!packet) return reply({ error: "Packet not found" }, 404);
      if (parts[5] === "document") {
        const frozen = documents.get(id), format = url.searchParams.get("format");
        if (format === "html") { res.setHeader("Content-Type", "text/html"); res.end(frozen?.html ?? buildPayrollPacketHtml(packet)); }
        else if (format === "csv") { res.setHeader("Content-Type", "text/csv"); res.end(frozen?.csv ?? buildPayrollPacketCsv(packet)); }
        else { res.setHeader("Content-Type", "application/pdf"); res.end(frozen?.pdf ?? buildPayrollPacketPdf(packet)); }
        return;
      }
      if (req.method === "PATCH") {
        if (body.expectedRevision !== packet.revision) return reply({ error: "Packet changed" }, 409);
        const action = body.action;
        if (action === "save" || action === "refresh") {
          if (packet.status !== "draft") return reply({ error: "Approved version is immutable" }, 409);
          packet.inputs = action === "save" ? body.inputs as PacketInput[] : packet.inputs.map(row => ({ ...row, reviewed: false }));
          if (body.checkDate) packet.check_date = String(body.checkDate);
          packet.snapshot = buildPayrollSnapshot(source, { periodStart: packet.period_start, periodEnd: packet.period_end, checkDate: packet.check_date, inputs: packet.inputs, now: new Date() });
        } else if (action === "approve") {
          if (packet.snapshot.blockers.length || packet.status !== "draft") return reply({ error: "Resolve review items" }, 409);
          packet.status = "approved"; packet.approved_at = new Date().toISOString(); packet.approved_by = actorId; packet.approved_by_name = "Synthetic operator";
          const pdf = buildPayrollPacketPdf(packet); packet.document_hash = createHash("sha256").update(pdf).digest("hex"); documents.set(id, { pdf, html: buildPayrollPacketHtml(packet), csv: buildPayrollPacketCsv(packet) });
        } else if (action === "report") { if (packet.status !== "approved") return reply({ error: "Approve first" }, 409); packet.status = "reported"; packet.report_method = body.method as "phone" | "run"; packet.report_reference = String(body.reference); packet.reported_at = new Date().toISOString(); }
        else if (action === "reconcile") { if (packet.status !== "reported" || body.matches !== true) return reply({ error: "Compare first" }, 409); packet.status = "reconciled"; packet.reconciled_at = new Date().toISOString(); packet.reconciliation_note = String(body.note); }
        else if (action === "amend") return reply({ packet: makePacket({ periodStart: packet.period_start, periodEnd: packet.period_end, checkDate: packet.check_date }, packet, String(body.reason)) });
        packet.revision++; packet.updated_at = new Date().toISOString();
        events.push({ id: randomUUID(), packet_id: id, action: String(action), actor_id: actorId, actor_name: "Synthetic operator", created_at: packet.updated_at, detail: { note: body.note } });
        return reply({ packet });
      }
      return reply({ packet, events: events.filter(e => e.packet_id === id), versions: [...packets.values()].filter(p => p.root_id === packet.root_id).map(p => ({ id: p.id, version: p.version, status: p.status })), stale: scenario === "stale" });
    } catch (error) { reply({ error: error instanceof Error ? error.message : "Synthetic request failed" }, 500); }
  });
} }], resolve: { alias: [{ find: "next/link", replacement: path.join(root, "scripts/workforce/fixture-link.tsx") }, { find: "next/navigation", replacement: path.join(here, "fixture-navigation.ts") }, { find: "@/contexts/haven-auth-context", replacement: path.join(here, "fixture-auth.ts") }, { find: "@", replacement: path.join(root, "src") }] }, css: { postcss: path.join(root, "postcss.config.mjs") }, server: { host: "127.0.0.1", port: 8949, strictPort: true, fs: { allow: [root] } }, logLevel: "error" });
await server.listen(); fs.writeFileSync(path.join(run, "preview-scope.json"), JSON.stringify({ origin: "http://127.0.0.1:8949", firstId: first.id, scope: "Synthetic persistence, real components, calculations and document renderer. Not hosted authentication or staff acceptance." }, null, 2));
console.log(`Payroll preview http://127.0.0.1:8949/admin/payroll/packets/${first.id}`);
