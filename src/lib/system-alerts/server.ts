import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendAlertEmail } from "../../../scripts/scheduled-jobs/email.mjs";

export const settingsInput = z.object({
  expectedVersion: z.number().int().min(0), enabled: z.boolean(),
  recipients: z.array(z.string().trim().email().max(254).toLowerCase()).max(10),
  alertKinds: z.array(z.enum(["job_failure", "job_recovery", "monitor_failure"])).min(1).max(3),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.recipients.length) ctx.addIssue({ code: "custom", message: "Add a recipient before enabling alerts" });
  if (new Set(value.recipients).size !== value.recipients.length) ctx.addIssue({ code: "custom", message: "Recipients must be unique" });
});
export const testInput = z.object({ expectedVersion: z.number().int().min(1) }).strict();
type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }> };
export async function alertRpc(name: string, args?: Record<string, unknown>) {
  const client = await createClient();
  return (client as unknown as RpcClient).rpc(name, args);
}
export function alertError(error: { code?: string }) {
  const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "22023" ? 422 : error.code === "54000" ? 429 : 503;
  const message = status === 409 ? "Settings changed. Reload before continuing." : status === 403 ? "Organization administrator access required." : status === 422 ? "Save valid recipients and alert settings first." : status === 429 ? "Wait one minute before sending another test." : "System alert settings are unavailable.";
  return NextResponse.json({ error: message }, { status });
}
export async function deliverTest(id: string) {
  const client = createServiceRoleClient() as unknown as RpcClient;
  const { data, error } = await client.rpc("system_alert_email_claim", { p_id: id, p_configured: Boolean(process.env.RESEND_API_KEY && process.env.SYSTEM_ALERT_EMAIL_FROM) });
  if (error || !data) return NextResponse.json({ error: "The test could not be claimed. Reload delivery history.", id }, { status: 503 });
  const delivery = data as { id: string; status?: string; claim_token: string };
  if (delivery.status === "unconfigured") return NextResponse.json({ id, status: "unconfigured", error: "Email provider is not configured." }, { status: 503 });
  const result = await sendAlertEmail(data);
  const saved = await client.rpc("system_alert_email_finish", { p_id: id, p_claim_token: delivery.claim_token, p_status: result.status, p_provider_id: result.provider_id ?? null, p_error_code: result.error_code ?? null });
  if (saved.error) return NextResponse.json({ error: "Email outcome could not be recorded. Check delivery history before retrying.", id }, { status: 503 });
  return NextResponse.json({ id, status: result.status, ...(result.status === "provider_accepted" ? {} : { error: result.status === "unconfigured" ? "Email provider is not configured." : "The email provider did not confirm acceptance." }) }, { status: result.status === "provider_accepted" ? 200 : result.status === "unconfigured" ? 503 : 502 });
}
