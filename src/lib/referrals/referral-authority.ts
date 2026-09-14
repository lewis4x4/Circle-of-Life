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

export type ReferralLeadUpdatePatch = Partial<
  Pick<ReferralLeadRow, "status" | "tour_scheduled_for" | "tour_completed_at">
>;

export type ReferralDuplicateCandidate = Pick<
  ReferralLeadRow,
  "id" | "facility_id" | "first_name" | "last_name" | "status"
>;

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

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
