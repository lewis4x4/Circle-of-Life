import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type ReferralLeadRow = Database["public"]["Tables"]["referral_leads"]["Row"] & {
  tour_scheduled_for: string | null;
  tour_completed_at: string | null;
  tour_owner_user_id: string | null;
  tour_expected_week: string | null;
};

type AuthorizedReferralLeadRpcRow = ReferralLeadRow & {
  referral_source_name: string | null;
  can_read_clinical: boolean;
  can_write: boolean;
};

export type AuthorizedReferralLeadRow = ReferralLeadRow & {
  referral_sources: { name: string } | null;
  can_read_clinical: boolean;
  can_write: boolean;
};

/** Tours are their own records now (COL-332); the lead update carries status only. */
export type ReferralLeadUpdatePatch = Partial<Pick<ReferralLeadRow, "status">>;

export type ReferralDuplicateCandidate = Pick<
  ReferralLeadRow,
  "id" | "facility_id" | "first_name" | "last_name" | "status"
>;

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export const REFERRAL_INITIAL_REVISION = "0".repeat(64);

export type ReferralEffectiveValue =
  | { precision: "unknown" }
  | { precision: "date"; date: string }
  | { precision: "instant"; at: string };

export type ReferralSourceKind =
  | "native"
  | "import"
  | "outage_replay";

export type ReferralRecordedSourceKind =
  | ReferralSourceKind
  | "hl7"
  | "system_compatibility";

export type ReferralInteractionMethod =
  Database["public"]["Enums"]["referral_interaction_method"];

export type ReferralEpisodeReply = {
  episode_id: string;
  episode_revision: string;
  status: Database["public"]["Enums"]["referral_lead_status"];
  work_state: "unassigned" | "assigned" | "waiting" | "review" | "closed";
  event_id: string;
  event_kind: string;
  replayed: boolean;
};

export type ReferralDownstreamReview = {
  reviewed: true;
  referral_lead_id: string;
  admission_cases: Array<{
    id: string;
    status: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  workflow_events: Array<{
    id: string;
    event_type: string;
    created_at: string;
    deleted_at: string | null;
  }>;
  hl7_inbound: Array<{
    id: string;
    status: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  outreach_activities: Array<{
    id: string;
    status: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  person_contacts: Array<{
    id: string;
    contact_id: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  contact_permissions: Array<{
    id: string;
    person_contact_id: string;
    permission_revision: string;
    updated_at: string;
  }>;
};

export type ReferralEpisodeHistory = {
  events: Array<{
    id: string;
    event_sequence: number;
    event_kind: string;
    from_status: Database["public"]["Enums"]["referral_lead_status"] | null;
    to_status: Database["public"]["Enums"]["referral_lead_status"];
    from_work_state: ReferralEpisodeReply["work_state"] | null;
    to_work_state: ReferralEpisodeReply["work_state"];
    effective_precision: ReferralEffectiveValue["precision"];
    effective_at: string | null;
    effective_date: string | null;
    recorded_at: string;
    actor_id: string;
    actor_role: string;
    /** Display name of whoever recorded the event; null when the profile has none. */
    actor_name: string | null;
    request_key: string;
    source_kind: ReferralRecordedSourceKind;
    source_reference: Record<string, unknown>;
    details: Record<string, unknown>;
  }>;
  next_before_sequence: number | null;
};

export type ReferralEpisodeModel = {
  episode: {
    id: string;
    facility_id: string;
    status: Database["public"]["Enums"]["referral_lead_status"];
    converted_resident_id: string | null;
    merged_into_lead_id: string | null;
    merged_at: string | null;
    merged_by: string | null;
    work_state: ReferralEpisodeReply["work_state"];
    episode_sequence: number;
    episode_revision: string;
    owner_user_id: string | null;
    backup_user_id: string | null;
    ownership_accepted_at: string | null;
    ownership_accepted_by: string | null;
    pending_owner_user_id: string | null;
    pending_backup_user_id: string | null;
    ownership_handoff_requested_at: string | null;
    ownership_handoff_requested_by: string | null;
    next_action: string | null;
    next_action_at: string | null;
    waiting_reason: string | null;
    review_reason: string | null;
    follow_up_at: string | null;
    reopen_count: number;
    receipt_precision: ReferralEffectiveValue["precision"];
    inquiry_date: string | null;
    receipt_effective_at: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    is_overdue: boolean;
  };
  person: {
    id: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    date_of_birth: string | null;
    identity_revision: string;
  };
  opportunity: {
    id: string;
    state: "open" | "closed";
    opened_at: string;
    closed_at: string | null;
    opportunity_revision: string;
  };
  facility_consideration: {
    id: string;
    facility_id: string;
    interest_state: "unknown" | "interested" | "not_interested";
    interest_recorded_at: string | null;
    interest_recorded_by: string | null;
    consideration_revision: string;
  };
  status_compatibility: {
    legacy_status: Database["public"]["Enums"]["referral_lead_status"];
    canonical_stage: string;
    episode_closed: boolean;
    proves_arrival: false;
    meaning: string;
  };
  contacts: Array<{
    person_contact_id: string;
    person_id: string;
    originating_referral_lead_id: string;
    belongs_to_current_person: boolean;
    contact_id: string;
    first_name: string;
    last_name: string;
    relationship: string;
    is_primary: boolean;
    phone: string | null;
    email: string | null;
    permissions: Array<{
      channel: "phone" | "sms" | "email";
      permission_state: "unknown" | "permitted" | "denied";
      evidence_note: string | null;
      recorded_at: string;
      recorded_by: string | null;
      permission_revision: string;
    }>;
  }>;
};

type ReferralCommandSource = {
  source_kind?: ReferralSourceKind;
  source_reference?: Record<string, unknown>;
};

export type ReferralEpisodeCommand =
  | ({ kind: "assign"; owner_user_id: string; backup_user_id?: string | null; next_action?: string | null; next_action_at?: string | null; override_reason?: string | null } & ReferralCommandSource)
  | ({ kind: "accept_coverage"; coverage_reason?: string | null } & ReferralCommandSource)
  | ({ kind: "record_interaction"; summary: string; method?: ReferralInteractionMethod | null; contacted_name?: string | null; person_contact_id?: string | null; effective: ReferralEffectiveValue; next_action?: string | null; next_action_at?: string | null } & ReferralCommandSource)
  | ({ kind: "wait" | "review"; reason: string; follow_up_at: string } & ReferralCommandSource)
  | ({ kind: "resume" | "reopen"; reason: string } & ReferralCommandSource)
  | ({ kind: "next_action"; next_action: string; next_action_at: string } & ReferralCommandSource)
  | ({ kind: "interest"; interest_state: "unknown" | "interested" | "not_interested"; effective: ReferralEffectiveValue } & ReferralCommandSource)
  | ({ kind: "close"; closure_reason_id: string; closed_by_party: "prospect" | "facility"; closure_note?: string | null; competitor_chosen?: string | null; effective: ReferralEffectiveValue } & ReferralCommandSource)
  | ({ kind: "close"; historical_outcome_unknown: true; is_historical: true; effective: ReferralEffectiveValue } & ReferralCommandSource)
  | ({ kind: "contact_add"; first_name: string; last_name: string; relationship: string; phone?: string | null; email?: string | null; is_primary?: boolean } & ReferralCommandSource)
  | ({ kind: "contact_link"; contact_id: string; relationship: string; is_primary?: boolean } & ReferralCommandSource)
  | ({ kind: "contact_permission"; person_contact_id: string; channel: "phone" | "sms" | "email"; permission_state: "unknown" | "permitted" | "denied"; evidence_note?: string | null } & ReferralCommandSource)
  | ({ kind: "identity_merge"; target_opportunity_id: string; target_opportunity_revision: string; reason: string; downstream_review: ReferralDownstreamReview } & ReferralCommandSource)
  | ({ kind: "identity_split"; reason: string; downstream_review: ReferralDownstreamReview } & ReferralCommandSource)
  | ({ kind: "identity_undo"; correction_id: string; reason: string; downstream_review: ReferralDownstreamReview } & ReferralCommandSource)
  | { kind: "admission_transition"; admission_case_id: string; target_status: "application_pending" };

function effectiveValuePayload(value: ReferralEffectiveValue): Record<string, unknown> {
  if (value.precision === "date") {
    return { effective_precision: "date", effective_date: value.date };
  }
  if (value.precision === "instant") {
    return { effective_precision: "instant", effective_at: value.at };
  }
  return { effective_precision: "unknown" };
}

function commandPayload(command: ReferralEpisodeCommand): Record<string, unknown> {
  const payload = { ...command } as Record<string, unknown>;
  delete payload.kind;
  if ("effective" in command) {
    delete payload.effective;
    return { ...payload, ...effectiveValuePayload(command.effective) };
  }
  return payload;
}

async function invokeReferralRpc<T>(
  client: SupabaseClient<Database>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = (await client.rpc(name as never, args as never)) as unknown as RpcResult<T>;
  if (result.error) throw result.error;
  if (result.data === null) throw new Error(`${name} returned no data.`);
  return result.data;
}

function mapAuthorizedLead(row: AuthorizedReferralLeadRpcRow): AuthorizedReferralLeadRow {
  const { referral_source_name: referralSourceName, ...lead } = row;
  return {
    ...lead,
    referral_sources: referralSourceName ? { name: referralSourceName } : null,
  };
}

export async function loadAuthorizedReferralLeads(
  client: SupabaseClient<Database>,
  options: {
    facilityId?: string | null;
    leadId?: string | null;
    status?: Database["public"]["Enums"]["referral_lead_status"] | null;
    limit?: number;
    offset?: number;
  },
): Promise<AuthorizedReferralLeadRow[]> {
  const rows = await invokeReferralRpc<AuthorizedReferralLeadRpcRow[]>(
    client,
    "referral_leads_authorized_read",
    {
      p_facility_id: options.facilityId ?? null,
      p_lead_id: options.leadId ?? null,
      p_status: options.status ?? null,
      p_limit: options.limit ?? 200,
      p_offset: options.offset ?? 0,
    },
  );
  return rows.map(mapAuthorizedLead);
}

export async function exportAuthorizedReferralLeads(
  client: SupabaseClient<Database>,
  options: {
    facilityId: string;
    status?: Database["public"]["Enums"]["referral_lead_status"] | null;
    limit?: number;
    offset?: number;
  },
): Promise<AuthorizedReferralLeadRow[]> {
  const rows = await invokeReferralRpc<AuthorizedReferralLeadRpcRow[]>(
    client,
    "referral_leads_authorized_export",
    {
      p_facility_id: options.facilityId,
      p_status: options.status ?? null,
      p_limit: options.limit ?? 500,
      p_offset: options.offset ?? 0,
    },
  );
  return rows.map(mapAuthorizedLead);
}

export function createAuthorizedReferralLead(
  client: SupabaseClient<Database>,
  input: {
    facilityId: string;
    firstName: string;
    lastName: string;
    referralSourceId: string;
    phone?: string | null;
    email?: string | null;
    preferredContact: Database["public"]["Enums"]["referral_lead_preferred_contact"];
    inquiryDate?: string | null;
  },
): Promise<string> {
  return invokeReferralRpc<string>(client, "referral_lead_create", {
    p_facility_id: input.facilityId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_referral_source_id: input.referralSourceId,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_preferred_contact: input.preferredContact,
    p_inquiry_date: input.inquiryDate ?? null,
  });
}

export function createAuthorizedReferralLeadFromHl7(
  client: SupabaseClient<Database>,
  inboundId: string,
): Promise<string> {
  return invokeReferralRpc<string>(client, "referral_lead_create_from_hl7", {
    p_inbound_id: inboundId,
  });
}

export function updateAuthorizedReferralLead(
  client: SupabaseClient<Database>,
  input: {
    leadId: string;
    expectedUpdatedAt: string;
    patch: ReferralLeadUpdatePatch;
  },
): Promise<string> {
  return invokeReferralRpc<string>(client, "referral_lead_update", {
    p_lead_id: input.leadId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_patch: input.patch,
  });
}

export function createAuthorizedReferralSource(
  client: SupabaseClient<Database>,
  input: { facilityId: string; name: string; sourceType: string; facilityOnly: boolean },
): Promise<string> {
  return invokeReferralRpc<string>(client, "referral_source_create", {
    p_facility_id: input.facilityId,
    p_name: input.name,
    p_source_type: input.sourceType,
    p_facility_only: input.facilityOnly,
  });
}

export function submitReferralTriage(
  client: SupabaseClient<Database>,
  input: {
    displayName: string;
    sourceChannel: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    receivedAt?: string | null;
  },
): Promise<string> {
  return invokeReferralRpc<string>(client, "referral_triage_submit", {
    p_display_name: input.displayName,
    p_source_channel: input.sourceChannel,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_notes: input.notes ?? null,
    p_received_at: input.receivedAt ?? null,
  });
}

export function loadReferralDuplicateCandidates(
  client: SupabaseClient<Database>,
  leadId: string,
): Promise<ReferralDuplicateCandidate[]> {
  return invokeReferralRpc<ReferralDuplicateCandidate[]>(client, "referral_duplicate_candidates", {
    p_lead_id: leadId,
  });
}

export function captureReferralEpisode(
  client: SupabaseClient<Database>,
  input: {
    requestKey: string;
    expectedRevision?: string;
    facilityId: string;
    firstName?: string;
    lastName?: string;
    preferredName?: string | null;
    dateOfBirth?: string | null;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    externalReference?: string | null;
    preferredContact?: Database["public"]["Enums"]["referral_lead_preferred_contact"];
    referralSourceId?: string | null;
    receipt: ReferralEffectiveValue;
    existingPersonId?: string | null;
    existingOpportunityId?: string | null;
    sourceKind?: ReferralSourceKind;
    sourceReference?: Record<string, unknown>;
  },
): Promise<ReferralEpisodeReply> {
  const receiptPayload =
    input.receipt.precision === "date"
      ? { receipt_precision: "date", inquiry_date: input.receipt.date }
      : input.receipt.precision === "instant"
        ? { receipt_precision: "instant", receipt_effective_at: input.receipt.at }
        : { receipt_precision: "unknown" };

  return invokeReferralRpc<ReferralEpisodeReply>(client, "referral_episode_capture", {
    p_request_key: input.requestKey,
    p_expected_revision: input.expectedRevision ?? REFERRAL_INITIAL_REVISION,
    p_payload: {
      facility_id: input.facilityId,
      ...(input.firstName !== undefined ? { first_name: input.firstName } : {}),
      ...(input.lastName !== undefined ? { last_name: input.lastName } : {}),
      ...(input.preferredName !== undefined ? { preferred_name: input.preferredName } : {}),
      ...(input.dateOfBirth !== undefined ? { date_of_birth: input.dateOfBirth } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.externalReference !== undefined
        ? { external_reference: input.externalReference }
        : {}),
      preferred_contact: input.preferredContact ?? "either",
      ...(input.referralSourceId !== undefined
        ? { referral_source_id: input.referralSourceId }
        : {}),
      ...(input.existingPersonId ? { existing_person_id: input.existingPersonId } : {}),
      ...(input.existingOpportunityId
        ? { existing_opportunity_id: input.existingOpportunityId }
        : {}),
      ...receiptPayload,
      source_kind: input.sourceKind ?? "native",
      source_reference: input.sourceReference ?? {},
    },
  });
}

export function runReferralEpisodeCommand(
  client: SupabaseClient<Database>,
  input: {
    episodeId: string;
    requestKey: string;
    expectedRevision: string;
    command: ReferralEpisodeCommand;
  },
): Promise<ReferralEpisodeReply> {
  return invokeReferralRpc<ReferralEpisodeReply>(client, "referral_episode_command", {
    p_episode_id: input.episodeId,
    p_request_key: input.requestKey,
    p_expected_revision: input.expectedRevision,
    p_command: input.command.kind,
    p_payload: commandPayload(input.command),
  });
}

export function loadReferralEpisodeDownstreamReview(
  client: SupabaseClient<Database>,
  episodeId: string,
): Promise<ReferralDownstreamReview> {
  return invokeReferralRpc<ReferralDownstreamReview>(
    client,
    "referral_episode_downstream_review",
    { p_episode_id: episodeId },
  );
}

export function loadReferralEpisodeHistory(
  client: SupabaseClient<Database>,
  input: { episodeId: string; beforeSequence?: number | null; limit?: number },
): Promise<ReferralEpisodeHistory> {
  return invokeReferralRpc<ReferralEpisodeHistory>(client, "referral_episode_history_read", {
    p_episode_id: input.episodeId,
    p_before_sequence: input.beforeSequence ?? null,
    p_limit: input.limit ?? 100,
  });
}

export function loadReferralEpisodeModel(
  client: SupabaseClient<Database>,
  episodeId: string,
): Promise<ReferralEpisodeModel> {
  return invokeReferralRpc<ReferralEpisodeModel>(client, "referral_episode_model_read", {
    p_episode_id: episodeId,
  });
}

export type ReferralOwnerPerson = { user_id: string; full_name: string };

export type ReferralEpisodeOwners = {
  self_user_id: string | null;
  owner: ReferralOwnerPerson | null;
  backup: ReferralOwnerPerson | null;
  pending_owner: ReferralOwnerPerson | null;
  /** Whether the reader may assign this lead (unowned, their own, or a supervisor). */
  can_assign: boolean;
  /** Staff who may own a lead at its facility; names only. */
  eligible: ReferralOwnerPerson[];
};

export function loadReferralEpisodeOwners(
  client: SupabaseClient<Database>,
  episodeId: string,
): Promise<ReferralEpisodeOwners> {
  return invokeReferralRpc<ReferralEpisodeOwners>(client, "referral_episode_owner_read", {
    p_episode_id: episodeId,
  });
}

export type ReferralTourOutcome = "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";

export type ReferralTour = {
  id: string;
  replaces_tour_id: string | null;
  replaced_by_tour_id: string | null;
  scheduled_for: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  outcome: ReferralTourOutcome;
  completed_at: string | null;
  /** Null when there is none or the reader may not see it; `feedback_restricted` says which. */
  feedback_note: string | null;
  feedback_restricted: boolean;
  recorded_at: string;
  recorded_by_name: string | null;
  outcome_recorded_at: string | null;
  outcome_recorded_by_name: string | null;
  /** Copied from the lead's old single-tour fields; only what was recorded there. */
  backfilled: boolean;
};

export type ReferralEpisodeTours = {
  self_user_id: string | null;
  /** Whether the reader may record tours on this lead (tour roles, lead not closed). */
  can_write: boolean;
  episode_revision: string;
  facility_id: string;
  facility_name: string | null;
  tours: ReferralTour[];
  /** People who may give a tour at this building; names only. Empty for readers who cannot write. */
  eligible_owners: ReferralOwnerPerson[];
};

export type ReferralTourCommand =
  | { kind: "schedule"; scheduled_for: string; owner_user_id: string }
  | { kind: "reschedule"; tour_id: string; scheduled_for: string; owner_user_id?: string | null; feedback_note?: string | null }
  | {
      kind: "record_outcome";
      tour_id: string;
      outcome: "completed" | "cancelled" | "no_show";
      completed_at?: string | null;
      feedback_note?: string | null;
    };

export type ReferralTourReply = ReferralEpisodeReply & { tour_id: string };

export function loadReferralEpisodeTours(
  client: SupabaseClient<Database>,
  episodeId: string,
): Promise<ReferralEpisodeTours> {
  return invokeReferralRpc<ReferralEpisodeTours>(client, "referral_episode_tours_read", {
    p_episode_id: episodeId,
  });
}

export function runReferralTourCommand(
  client: SupabaseClient<Database>,
  input: {
    episodeId: string;
    requestKey: string;
    expectedRevision: string;
    command: ReferralTourCommand;
  },
): Promise<ReferralTourReply> {
  const payload = { ...input.command } as Record<string, unknown>;
  delete payload.kind;
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined || payload[key] === null) delete payload[key];
  }
  return invokeReferralRpc<ReferralTourReply>(client, "referral_tour_command", {
    p_episode_id: input.episodeId,
    p_request_key: input.requestKey,
    p_expected_revision: input.expectedRevision,
    p_command: input.command.kind,
    p_payload: payload,
  });
}
