import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/types/database";

/**
 * Facility Operator Home — the On-tap feed as the database returns it
 * (`public.home_on_tap`, migration 459). Validated at the seam so a payload
 * drift fails loudly here rather than as a blank card.
 */

const personSchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
});

const ownerSchema = z.union([
  z.object({ kind: z.literal("queue") }),
  z.object({
    kind: z.literal("user"),
    userId: z.string(),
    displayName: z.string().nullable().optional(),
    claimedAt: z.string().nullable().optional(),
  }),
]);

const assetScheduleSchema = z.object({
  assetName: z.string().nullable().optional(),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  localTime: z.string().nullable().optional(),
  setAt: z.string().nullable().optional(),
  lastServiceAt: z.string().nullable().optional(),
});

export const homeOnTapRowSchema = z.object({
  id: z.string(),
  instanceId: z.string(),
  bucket: z.enum(["regulatory", "assigned"]),
  title: z.string(),
  category: z.string().nullable().optional(),
  cadence: z.string().nullable().optional(),
  status: z.string(),
  assignedShiftDate: z.string(),
  dueAt: z.string().nullable().optional(),
  overdue: z.boolean().optional(),
  licenseThreatening: z.boolean().optional(),
  requiresDualSign: z.boolean().optional(),
  catalogKey: z.string().nullable().optional(),
  owner: ownerSchema,
  assetSchedule: assetScheduleSchema.nullable().optional(),
  completedAt: z.string().nullable().optional(),
  completedBy: z.string().nullable().optional(),
  completionNotes: z.string().nullable().optional(),
  escalationLevel: z.number().nullable().optional(),
  href: z.string(),
});

export const homeOnTapPayloadSchema = z.object({
  facilityId: z.string(),
  facilityName: z.string(),
  timezone: z.string(),
  asOf: z.string(),
  localDate: z.string(),
  isWeekend: z.boolean(),
  endOfDayLocal: z.string(),
  escalatesTo: z
    .object({ userId: z.string(), displayName: z.string().nullable().optional(), title: z.string() })
    .nullable()
    .optional(),
  coOperators: z.array(personSchema).default([]),
  onDutyToday: z.array(personSchema).default([]),
  counts: z.object({
    regulatory: z.number(),
    assigned: z.number(),
    clearedToday: z.number(),
    later: z.number(),
  }),
  rows: z.array(homeOnTapRowSchema).default([]),
  later: z.array(homeOnTapRowSchema).default([]),
  cleared: z.array(homeOnTapRowSchema).default([]),
});

export type HomeOnTapRow = z.infer<typeof homeOnTapRowSchema>;
export type HomeOnTapPayload = z.infer<typeof homeOnTapPayloadSchema>;
export type HomeOnTapPerson = z.infer<typeof personSchema>;

export class HomeOnTapPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomeOnTapPayloadError";
  }
}

export function parseHomeOnTapPayload(data: unknown): HomeOnTapPayload {
  const parsed = homeOnTapPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new HomeOnTapPayloadError(`home_on_tap returned an unexpected payload: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return parsed.data;
}

/**
 * One request. SECURITY INVOKER on the database side: RLS on
 * operation_task_instances is the scope, so a caller at building A never sees
 * building B whatever id is passed.
 */
export async function fetchHomeOnTap(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  asOf?: Date,
): Promise<HomeOnTapPayload> {
  const { data, error } = await supabase.rpc("home_on_tap", {
    p_facility_id: facilityId,
    ...(asOf ? { p_as_of: asOf.toISOString() } : {}),
  });
  if (error) throw new Error(error.message);
  return parseHomeOnTapPayload(data);
}

export async function claimHomeTask(
  supabase: SupabaseClient<Database>,
  instanceId: string,
  claim: boolean,
): Promise<{ assignedTo: string | null; assignedAt: string | null }> {
  const { data, error } = await supabase.rpc("home_claim_task", { p_instance_id: instanceId, p_claim: claim });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { assignedTo?: string | null; assignedAt?: string | null };
  return { assignedTo: result.assignedTo ?? null, assignedAt: result.assignedAt ?? null };
}
