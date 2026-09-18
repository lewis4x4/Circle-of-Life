/**
 * observation-escalation-engine: the tick.
 *
 * Three steps, in order:
 *
 *   1. mark tasks whose window has closed as overdue, through
 *      `advance_observation_task_lapse`
 *   2. fire every rung that is due and has not fired, through
 *      `observation_escalations_due` and `record_observation_escalation_rung`
 *   3. drain the delivery queue those rungs wrote, over in_app, push and sms
 *
 * Nothing in this file carries an escalation offset, a recipient, a channel, a
 * shift boundary, a grace value or a timer. Step 1 and step 2 read them from
 * `facility_escalation_versions` and its rungs, including the per shift
 * overrides; step 3 sends over whatever channels the rows came back with. The
 * window close each offset is measured from is resolved in SQL by
 * `observation_task_window_close`, never here.
 *
 * Idempotence is the database's, not this file's: `record_observation_escalation_rung`
 * inserts into a dispatch ledger with a unique index on (task_id, rung_key) and
 * answers `fired: false` when the rung already fired, so a re-tick, a retry, or
 * two overlapping cron runs write nothing twice.
 *
 * The nudge is an assigned staff only rung. It gets a dispatch row and delivery
 * rows and no `resident_observation_escalations` row at all, so it cannot
 * inflate an escalation count.
 *
 * Everything that touches the network or the database is injected so the tick
 * can be exercised in a unit test with fakes. index.ts wires the real
 * service-role client and global fetch.
 *
 * PHI: no name, phone or message body is ever logged. Log lines carry ids,
 * channels, rung keys, status codes and counts only.
 */
import {
  buildEscalationMessage,
  classifyPushResponse,
  classifyTwilioResponse,
  type DeliveryChannel,
  type DeliveryOutcomeStatus,
  smsChannelEnabled,
} from "./message.ts";

export const DUE_LIMIT = 500;
export const DRAIN_LIMIT = 200;
export const SEND_CONCURRENCY = 10;
export const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01/Accounts";

/** One row of `public.observation_escalations_due`. */
export interface DueRungRow {
  task_id: string;
  organization_id: string;
  facility_id: string;
  resident_id: string;
  escalation_version_id: string;
  rung_key: string;
  label: string;
  is_terminal: boolean;
  assigned_staff_only: boolean;
  channels: string[];
  shift_key: string | null;
  window_closes_at: string;
  fire_at: string;
}

/** The jsonb `public.record_observation_escalation_rung` answers with. */
export interface FireResult {
  fired: boolean;
  reason?: string;
  rung_key?: string;
  dispatch_id?: string;
  escalation_id?: string | null;
  is_escalation?: boolean;
  deliveries_queued?: number;
  recipients?: number;
}

/** One queued row of `public.observation_escalation_deliveries`. */
export interface DeliveryRow {
  id: string;
  organization_id: string;
  facility_id: string;
  dispatch_id: string | null;
  rung_key: string;
  target_user_id: string | null;
  target_phone: string | null;
  channel: DeliveryChannel;
  is_test: boolean;
  message_body: string | null;
}

/**
 * What a real delivery needs to compose its body. A test send carries its own
 * stored body and needs none of this.
 */
export interface DispatchContext {
  taskId: string;
  label: string;
  protocolText: string | null;
  isReminder: boolean;
  /** The only resident identifier that reaches a body. */
  room: string | null;
}

export interface DeliveryPatch {
  status: DeliveryOutcomeStatus;
  skip_reason?: string | null;
  provider_message_id?: string | null;
  error_message?: string | null;
  sent_at?: string | null;
}

export interface EngineStore {
  advanceLapse(organizationId: string, facilityId: string | null, atIso: string): Promise<number>;
  loadDue(organizationId: string, facilityId: string | null, atIso: string, limit: number): Promise<DueRungRow[]>;
  fireRung(taskId: string, rungKey: string, atIso: string): Promise<FireResult>;
  claimDeliveries(
    organizationId: string,
    facilityId: string | null,
    claimToken: string,
    nowIso: string,
    limit: number,
  ): Promise<DeliveryRow[]>;
  loadDispatchContexts(dispatchIds: readonly string[]): Promise<Map<string, DispatchContext>>;
  loadUserPhones(userIds: readonly string[]): Promise<Map<string, string | null>>;
  recordDeliveryOutcome(id: string, claimToken: string, patch: DeliveryPatch): Promise<void>;
}

export interface EngineLogger {
  log(entry: Record<string, unknown> & { event: string }): void;
}

export interface EngineEnv extends Record<string, string | undefined> {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DISPATCH_PUSH_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  OBSERVATION_ESCALATION_SMS_ENABLED?: string;
  OBSERVATION_ESCALATION_APP_BASE_URL?: string;
}

export interface EngineOptions {
  store: EngineStore;
  fetchImpl: typeof fetch;
  env: EngineEnv;
  log: EngineLogger;
  organizationId: string;
  facilityId?: string | null;
  now?: Date;
  dueLimit?: number;
  drainLimit?: number;
}

export interface EngineResult {
  tasks_lapsed: number;
  rungs_due: number;
  rungs_fired: number;
  rungs_already_fired: number;
  escalations_recorded: number;
  reminders_recorded: number;
  deliveries_processed: number;
  deliveries_sent: number;
  deliveries_skipped: number;
  deliveries_failed: number;
  sms_enabled: boolean;
}

interface Outcome {
  status: DeliveryOutcomeStatus;
  skipReason?: string;
  providerMessageId?: string;
  error?: string;
}

function unique(values: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of values) if (value) out.add(value);
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
  options: EngineOptions,
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
  return classifyPushResponse(response.status, await readJson(response));
}

async function sendSms(to: string, body: string, options: EngineOptions): Promise<Outcome> {
  const accountSid = (options.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = (options.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const from = (options.env.TWILIO_FROM_NUMBER ?? "").trim();
  const form = new URLSearchParams({ To: to, From: from, Body: body });

  let response: Response;
  try {
    response = await options.fetchImpl(`${TWILIO_API_BASE}/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
  } catch (error) {
    return fetchFailure("twilio sms", error);
  }
  const classified = classifyTwilioResponse(response.status, await readJson(response));
  return classified.status === "sent"
    ? { status: "sent", providerMessageId: classified.providerMessageId }
    : { status: "failed", error: classified.error };
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

async function fireDueRungs(options: EngineOptions, atIso: string, result: EngineResult): Promise<void> {
  const due = await options.store.loadDue(
    options.organizationId,
    options.facilityId ?? null,
    atIso,
    options.dueLimit ?? DUE_LIMIT,
  );
  result.rungs_due = due.length;

  for (const row of due) {
    let fired: FireResult;
    try {
      fired = await options.store.fireRung(row.task_id, row.rung_key, atIso);
    } catch (error) {
      options.log.log({
        event: "rung_fire_failed",
        outcome: "error",
        task_id: row.task_id,
        rung_key: row.rung_key,
        error_message: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }

    if (!fired.fired) {
      if (fired.reason === "already_fired") result.rungs_already_fired += 1;
      continue;
    }

    result.rungs_fired += 1;
    if (fired.is_escalation) result.escalations_recorded += 1;
    else result.reminders_recorded += 1;
  }
}

async function drainDeliveries(options: EngineOptions, result: EngineResult): Promise<void> {
  const nowIso = (options.now ?? new Date()).toISOString();
  // Scoped to the tick. The unscoped version of this call sent every queued
  // delivery in the database, whichever facility and whichever tenant it
  // belonged to, and claiming is what stops two overlapping ticks sending the
  // same one twice.
  // One token per drain. It is what the outcome write is checked against, so a
  // tick that finishes after its claim was reclaimed writes nothing instead of
  // overwriting the result of the tick that actually sent the message.
  const claimToken = crypto.randomUUID();
  const deliveries = await options.store.claimDeliveries(
    options.organizationId,
    options.facilityId ?? null,
    claimToken,
    nowIso,
    options.drainLimit ?? DRAIN_LIMIT,
  );
  if (deliveries.length === 0) return;

  const contexts = await options.store.loadDispatchContexts(unique(deliveries.map((d) => d.dispatch_id)));

  const smsEnabled = smsChannelEnabled(options.env);
  result.sms_enabled = smsEnabled;
  const phoneLookupIds = smsEnabled
    ? unique(deliveries.filter((d) => d.channel === "sms" && !d.target_phone).map((d) => d.target_user_id))
    : [];
  const phones = phoneLookupIds.length > 0
    ? await options.store.loadUserPhones(phoneLookupIds)
    : new Map<string, string | null>();

  const appBaseUrl = options.env.OBSERVATION_ESCALATION_APP_BASE_URL ?? "";

  const resolve = async (delivery: DeliveryRow): Promise<Outcome> => {
    // A test send carries its own body, already prefixed with the word TEST by
    // send_test_escalation, and has no dispatch and no resident behind it.
    let message: { title: string; body: string; url: string };
    if (delivery.is_test) {
      if (!delivery.message_body) return { status: "skipped", skipReason: "no_test_body" };
      message = { title: delivery.rung_key, body: delivery.message_body, url: "" };
    } else {
      const context = delivery.dispatch_id ? contexts.get(delivery.dispatch_id) : undefined;
      if (!context) return { status: "skipped", skipReason: "dispatch_not_found" };
      message = buildEscalationMessage({
        label: context.label,
        protocolText: context.protocolText,
        isReminder: context.isReminder,
        room: context.room,
        taskId: context.taskId,
        appBaseUrl,
      });
    }

    // Deliberate, named exception to the "no channel literal in code" rule.
    // Which channels a rung uses is configuration and is never written here:
    // this switch is the transport, and a transport has to name the pipe it
    // sends down. Adding a channel means adding a case, which is a deploy, and
    // that is correct because a channel nobody has written a sender for cannot
    // be enabled by editing a row. care-event-dispatcher branches the same way
    // for the same reason.
    switch (delivery.channel) {
      case "in_app":
        // The escalation row and the dispatch row are the in-app artifact; the
        // module surface reads them. Nothing further to send.
        return { status: "sent" };
      case "push":
        return await sendPush(delivery, message, options);
      case "sms": {
        if (!smsEnabled) return { status: "skipped", skipReason: "channel_not_enabled" };
        const phone = (delivery.target_phone ??
          (delivery.target_user_id ? phones.get(delivery.target_user_id) : null) ?? "").trim();
        if (!phone) return { status: "skipped", skipReason: "no_phone" };
        return await sendSms(phone, message.body, options);
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
      outcome = { status: "failed", error: `engine error: ${error instanceof Error ? error.name : "Error"}` };
    }
    result.deliveries_processed += 1;
    if (outcome.status === "sent") result.deliveries_sent += 1;
    else if (outcome.status === "skipped") result.deliveries_skipped += 1;
    else result.deliveries_failed += 1;

    if (outcome.status === "failed") {
      options.log.log({
        event: "delivery_failed",
        outcome: "error",
        delivery_id: delivery.id,
        channel: delivery.channel,
        rung_key: delivery.rung_key,
        error_message: outcome.error,
      });
    }
    try {
      await options.store.recordDeliveryOutcome(delivery.id, claimToken, patchFor(outcome, new Date().toISOString()));
    } catch (error) {
      // The send happened and its outcome could not be written. The row stays
      // claimed, so the attempt counter in the claim command is what stops this
      // becoming a resend loop; this log is how a human finds out it happened.
      options.log.log({
        event: "delivery_outcome_not_recorded",
        outcome: "error",
        delivery_id: delivery.id,
        channel: delivery.channel,
        rung_key: delivery.rung_key,
        error_message: error instanceof Error ? error.name : "Error",
      });
    }
  };

  for (let i = 0; i < deliveries.length; i += SEND_CONCURRENCY) {
    await Promise.all(deliveries.slice(i, i + SEND_CONCURRENCY).map(processOne));
  }
}

export async function runEscalationEngine(options: EngineOptions): Promise<EngineResult> {
  const now = options.now ?? new Date();
  const atIso = now.toISOString();
  const result: EngineResult = {
    tasks_lapsed: 0,
    rungs_due: 0,
    rungs_fired: 0,
    rungs_already_fired: 0,
    escalations_recorded: 0,
    reminders_recorded: 0,
    deliveries_processed: 0,
    deliveries_sent: 0,
    deliveries_skipped: 0,
    deliveries_failed: 0,
    sms_enabled: false,
  };

  result.tasks_lapsed = await options.store.advanceLapse(
    options.organizationId,
    options.facilityId ?? null,
    atIso,
  );

  await fireDueRungs(options, atIso, result);
  await drainDeliveries(options, result);

  options.log.log({
    event: "complete",
    outcome: result.deliveries_failed === 0 ? "success" : "error",
    organization_id: options.organizationId,
    ...result,
  });
  return result;
}
