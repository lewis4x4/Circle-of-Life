import { z } from "zod";
import { requestKeySchema } from "@/lib/operations/occurrences";

const uuid = z.string().uuid();
export const helpHandoverTargetSchema = z.object({ activity_id: uuid, facility_id: uuid, occurrence_id: uuid.optional() }).strict();
const base = { activity_id: uuid, facility_id: uuid, request_key: requestKeySchema, expected_id: uuid.nullable() };
export const helpHandoverCommandSchema = z.discriminatedUnion("command", [
  z.object({ ...base, command: z.literal("help"), payload: z.object({ how_to: z.string().trim().min(1).max(8000), examples: z.string().trim().max(4000), contact: z.string().trim().max(1000), protected_document_ids: z.array(uuid).max(20).optional() }).strict() }).strict(),
  z.object({ ...base, command: z.literal("propose"), payload: z.object({ duty_scope: z.string().trim().min(1).max(500), owner_user_id: uuid, backup_user_id: uuid.optional(), effective_at: z.string().datetime({ offset: true }), note: z.string().trim().min(1).max(2000) }).strict().refine(p => p.owner_user_id !== p.backup_user_id, "Backup must differ from owner") }).strict(),
  z.object({ ...base, command: z.literal("accept"), payload: z.object({ proposal_id: uuid, duty_role: z.enum(["owner", "backup"]) }).strict() }).strict(),
]);
export type HelpHandoverEvent = { id: string; command: "help" | "propose" | "accept"; duty_scope: string; payload: Record<string, unknown>; actor_id: string; created_at: string; previous_id: string | null };
export type DutyProjection = { proposal_id: string; duty_scope: string; owner_user_id: string; backup_user_id: string | null; effective_at: string; owner_accepted_at: string | null; backup_accepted_at: string | null; active: boolean; owner_current: boolean; backup_current: boolean; covered: boolean; latest_event_id: string };
export type HelpHandoverData = { actor_id: string; facility_id: string; activity_id: string; can_publish: boolean; can_assign: boolean; people: { id: string; name: string }[]; help: HelpHandoverEvent | null; help_history: HelpHandoverEvent[]; duty_history: HelpHandoverEvent[]; current_duties: DutyProjection[]; open_issues: Record<string, unknown>[]; open_occurrences: Record<string, unknown>[]; governing_requirement: Record<string, unknown> | null; governing_facility_requirement: Record<string, unknown> | null };

/** Keep prior accepted ownership active until its accepted replacement becomes effective. */
export function projectLocalDuties(events: HelpHandoverEvent[], now = Date.now(), currentPeople?: string[]): DutyProjection[] {
 const ordered = [...events].sort((a,b) => (Date.parse(a.created_at)-Date.parse(b.created_at)) || a.id.localeCompare(b.id));
 const proposals = ordered.filter(e => e.command === "propose").map(e => {
  const accepts = ordered.filter(a => a.command === "accept" && a.payload.proposal_id === e.id);
  const owner = accepts.find(a => a.payload.duty_role === "owner" && a.actor_id === e.payload.owner_user_id);
  const backup = accepts.find(a => a.payload.duty_role === "backup" && a.actor_id === e.payload.backup_user_id);
  const latest = ordered.filter(a => a.duty_scope === e.duty_scope).at(-1)!;
  return { proposal_id: e.id, duty_scope: e.duty_scope, owner_user_id: String(e.payload.owner_user_id), backup_user_id: typeof e.payload.backup_user_id === "string" ? e.payload.backup_user_id : null, effective_at: String(e.payload.effective_at), owner_accepted_at: owner?.created_at ?? null, backup_accepted_at: backup?.created_at ?? null, owner_current: currentPeople ? currentPeople.includes(String(e.payload.owner_user_id)) : true, backup_current: currentPeople ? currentPeople.includes(String(e.payload.backup_user_id)) : false, covered: false, active: !!owner && Math.max(Date.parse(String(e.payload.effective_at)), Date.parse(owner.created_at)) <= now, latest_event_id: latest.id };
 });
 for (const p of proposals) if (p.active && proposals.some(q => q !== p && q.duty_scope === p.duty_scope && q.active && proposals.indexOf(q) > proposals.indexOf(p))) p.active = false;
 for (const p of proposals) p.covered=p.active && p.owner_current;
 return proposals;
}
export function helpHandoverError(error: { code?: string }): { status: number; error: string } {
 if (error.code === "42501") return { status: 403, error: "Operation unavailable" };
 if (["22023", "22P02", "22007", "22008", "23503"].includes(error.code ?? "")) return { status: 400, error: "Check the help or handover details" };
 if (["P0001", "23505"].includes(error.code ?? "")) return { status: 409, error: "Help or handover changed. Refresh before trying again." };
 return { status: 503, error: "Outcome uncertain. Refresh before retrying." };
}
