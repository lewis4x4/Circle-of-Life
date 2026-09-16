/**
 * care-event-dispatcher: the drain.
 *
 * Reads queued care_event_deliveries whose send_after has passed and sends
 * each one over its channel (spec 07A section 6.2, "Edge Function
 * care-event-dispatcher"):
 *
 *   in_app  -> mark sent; the exec_alerts row already exists.
 *   push    -> dispatch-push with x-dispatch-secret.
 *   sms     -> Twilio Messages API, only when Twilio is enabled.
 *   voice   -> Twilio Calls API with a <Say> TwiML, only when Twilio is enabled.
 *
 * A row whose parent care_events row is already acknowledged is skipped with
 * skip_reason = 'acknowledged' and nothing is sent. Rows for closed events are
 * still delivered.
 *
 * Everything that touches the network or the database is injected so the
 * drain can be exercised in a unit test with fakes. index.ts wires the real
 * service-role client and global fetch.
 *
 * PHI: no name, phone, or message body is ever logged. Log lines carry
 * delivery ids, channels, status codes, and counts only.
 */
import {
  buildCareEventMessage,
  classifyPushResponse,
  classifyTwilioResponse,
  twilioChannelEnabled,
  voiceTwiml,
} from "./message.ts";

export const DRAIN_LIMIT = 200;
export const SEND_CONCURRENCY = 10;
export const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01/Accounts";

export type DeliveryChannel = "in_app" | "push" | "sms" | "voice";

export interface DeliveryRow {
  id: string;
  organization_id: string;
  facility_id: string;
  care_event_id: string;
  escalation_step: number;
  target_role: string | null;
  target_user_id: string | null;
  target_phone: string | null;
  channel: DeliveryChannel;
  send_after: string;
}

export interface CareEventRow {
  id: string;
  resident_id: string | null;
  kind: string;
  final_level: string;
  status: string;
  deleted_at: string | null;
}

/** The only resident facts the dispatcher is allowed to see (07A section 10). */
export interface ResidentContext {
  firstName: string | null;
  lastName: string | null;
  room: string | null;
}

export interface DeliveryPatch {
  status: "sent" | "skipped" | "failed";
  skip_reason?: string | null;
  provider_message_id?: string | null;
  error_message?: string | null;
  sent_at?: string | null;
}

export interface DispatcherStore {
  loadQueuedDeliveries(nowIso: string, limit: number): Promise<DeliveryRow[]>;
  loadCareEvents(ids: readonly string[]): Promise<CareEventRow[]>;
  loadResidentContexts(residentIds: readonly string[]): Promise<Map<string, ResidentContext>>;
  loadUserPhones(userIds: readonly string[]): Promise<Map<string, string | null>>;
  updateDelivery(id: string, patch: DeliveryPatch): Promise<void>;
}

export interface DispatcherLogger {
  log(entry: Record<string, unknown> & { event: string }): void;
}

export interface DispatcherEnv extends Record<string, string | undefined> {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DISPATCH_PUSH_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  CARE_EVENT_SMS_ENABLED?: string;
  CARE_EVENT_APP_BASE_URL?: string;
}

export interface DispatcherOptions {
  store: DispatcherStore;
  fetchImpl: typeof fetch;
  env: DispatcherEnv;
  log: DispatcherLogger;
  now?: Date;
  limit?: number;
}

export interface DispatcherResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface Outcome {
  status: "sent" | "skipped" | "failed";
  skipReason?: string;
  providerMessageId?: string;
  error?: string;
}

function unique(values: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const v of values) if (v) out.add(v);
  return [...out];
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function fetchFailure(prefix: string, error: unknown): Outcome {
  const name = error instanceof Error ? error.name : "Error";
  return { status: "failed", error: `${prefix} request failed: ${name}` };
}

async function sendPush(
  delivery: DeliveryRow,
  message: { title: string; body: string; url: string },
  options: DispatcherOptions,
): Promise<Outcome> {
  const secret = (options.env.DISPATCH_PUSH_SECRET ?? "").trim();
  const supabaseUrl = (options.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!secret || !supabaseUrl) return { status: "skipped", skipReason: "channel_not_enabled" };
  if (!delivery.target_user_id) return { status: "skipped", skipReason: "no_target_user" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-dispatch-secret": secret,
  };
  const serviceKey = (options.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (serviceKey) headers.Authorization = `Bearer ${serviceKey}`;

  let response: Response;
  try {
    response = await options.fetchImpl(`${supabaseUrl}/functions/v1/dispatch-push`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: delivery.target_user_id,
        title: message.title,
        body: message.body,
        url: message.url,
      }),
    });
  } catch (error) {
    return fetchFailure("dispatch-push", error);
  }
  const payload = await readJson(response);
  return classifyPushResponse(response.status, payload);
}

async function sendTwilio(
  channel: "sms" | "voice",
  to: string,
  body: string,
  options: DispatcherOptions,
): Promise<Outcome> {
  const accountSid = (options.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = (options.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const from = (options.env.TWILIO_FROM_NUMBER ?? "").trim();
  const form = channel === "sms"
    ? new URLSearchParams({ To: to, From: from, Body: body })
    : new URLSearchParams({ To: to, From: from, Twiml: voiceTwiml(body) });
  const resource = channel === "sms" ? "Messages.json" : "Calls.json";

  let response: Response;
  try {
    response = await options.fetchImpl(`${TWILIO_API_BASE}/${encodeURIComponent(accountSid)}/${resource}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
  } catch (error) {
    return fetchFailure(`twilio ${channel}`, error);
  }
  const payload = await readJson(response);
  const result = classifyTwilioResponse(response.status, payload, channel);
  return result.status === "sent"
    ? { status: "sent", providerMessageId: result.providerMessageId }
    : { status: "failed", error: result.error };
}

function patchFor(outcome: Outcome, nowIso: string): DeliveryPatch {
  if (outcome.status === "sent") {
    return {
      status: "sent",
      sent_at: nowIso,
      provider_message_id: outcome.providerMessageId ?? null,
      skip_reason: null,
      error_message: null,
    };
  }
  if (outcome.status === "skipped") {
    return { status: "skipped", skip_reason: outcome.skipReason ?? null, error_message: null };
  }
  return { status: "failed", error_message: outcome.error ?? "unknown", skip_reason: null };
}

export async function runDispatcher(options: DispatcherOptions): Promise<DispatcherResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = options.limit ?? DRAIN_LIMIT;
  const result: DispatcherResult = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  const deliveries = await options.store.loadQueuedDeliveries(nowIso, limit);
  if (deliveries.length === 0) {
    options.log.log({ event: "complete", outcome: "success", ...result });
    return result;
  }

  const events = new Map<string, CareEventRow>();
  for (const event of await options.store.loadCareEvents(unique(deliveries.map((d) => d.care_event_id)))) {
    events.set(event.id, event);
  }

  const residentIds = unique([...events.values()].map((e) => e.resident_id));
  const residents = residentIds.length > 0 ? await options.store.loadResidentContexts(residentIds) : new Map<string, ResidentContext>();

  const twilioEnabled = twilioChannelEnabled(options.env);
  const phoneLookupIds = twilioEnabled
    ? unique(deliveries.filter((d) => (d.channel === "sms" || d.channel === "voice") && !d.target_phone).map((d) => d.target_user_id))
    : [];
  const phones = phoneLookupIds.length > 0 ? await options.store.loadUserPhones(phoneLookupIds) : new Map<string, string | null>();

  const appBaseUrl = options.env.CARE_EVENT_APP_BASE_URL ?? "";

  const resolve = async (delivery: DeliveryRow): Promise<Outcome> => {
    const event = events.get(delivery.care_event_id);
    if (!event || event.deleted_at) return { status: "skipped", skipReason: "event_not_found" };
    if (event.status === "acknowledged") return { status: "skipped", skipReason: "acknowledged" };

    const resident = event.resident_id ? residents.get(event.resident_id) : undefined;
    const message = buildCareEventMessage({
      firstName: resident?.firstName ?? null,
      lastName: resident?.lastName ?? null,
      room: resident?.room ?? null,
      kind: event.kind,
      level: event.final_level,
      careEventId: event.id,
      appBaseUrl,
    });

    switch (delivery.channel) {
      case "in_app":
        return { status: "sent" };
      case "push":
        return await sendPush(delivery, message, options);
      case "sms":
      case "voice": {
        if (!twilioEnabled) return { status: "skipped", skipReason: "channel_not_enabled" };
        const phone = (delivery.target_phone ?? (delivery.target_user_id ? phones.get(delivery.target_user_id) : null) ?? "").trim();
        if (!phone) return { status: "skipped", skipReason: "no_phone" };
        return await sendTwilio(delivery.channel, phone, message.body, options);
      }
      default:
        return { status: "skipped", skipReason: "unknown_channel" };
    }
  };

  const processOne = async (delivery: DeliveryRow): Promise<void> => {
    let outcome: Outcome;
    try {
      outcome = await resolve(delivery);
    } catch (error) {
      outcome = { status: "failed", error: `dispatcher error: ${error instanceof Error ? error.name : "Error"}` };
    }
    result.processed += 1;
    result[outcome.status] += 1;
    if (outcome.status === "failed") {
      options.log.log({
        event: "delivery_failed",
        outcome: "error",
        delivery_id: delivery.id,
        channel: delivery.channel,
        error_message: outcome.error,
      });
    }
    try {
      await options.store.updateDelivery(delivery.id, patchFor(outcome, new Date().toISOString()));
    } catch (error) {
      options.log.log({
        event: "update_failed",
        outcome: "error",
        delivery_id: delivery.id,
        error_message: error instanceof Error ? error.name : "Error",
      });
    }
  };

  for (let i = 0; i < deliveries.length; i += SEND_CONCURRENCY) {
    await Promise.all(deliveries.slice(i, i + SEND_CONCURRENCY).map(processOne));
  }

  options.log.log({
    event: "complete",
    outcome: result.failed === 0 ? "success" : "error",
    twilio_enabled: twilioEnabled,
    ...result,
  });
  return result;
}
