/**
 * The facility level Monitoring Orders list. Spec 25A section 4, defect 9.
 *
 * Entry stays on the resident record, where section 4.5 puts it and where the
 * paperwork is. This tab is the list: every order in force at the building, and
 * the ones that have closed, so an administrator can answer "who is on a
 * different cadence right now and why" without opening residents one at a time.
 *
 * Two reads rather than one nested embed. `resident_monitoring_orders` holds
 * three foreign keys to `user_profiles` (`entered_by`, `cancelled_by`,
 * `created_by`), so any embed of it has to name the constraint; that form is
 * proven in this repo. Reaching room through the order to the resident to the
 * bed to the room is a third level of nesting this repo has not proven, and an
 * unproven embed is exactly how `42703` took two tabs down, so residents are
 * read separately using the shape that is proven.
 *
 * No interval, grace value or lookback appears here. "Recent" is a row count,
 * not a duration: a fixed number of closed orders, most recent first.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Closed orders kept on screen. A row budget, deliberately not a time window. */
const CLOSED_ORDER_LIMIT = 25;

const ORDER_SELECT = [
  "id",
  "facility_id",
  "resident_id",
  "interval_minutes",
  "starts_at",
  "ends_at",
  "review_due_at",
  "ordered_by_type",
  "ordered_by_name",
  "order_received_as",
  "reason_category",
  "reason_note",
  "status",
  "cancel_reason",
  "cancelled_at",
  "closed_at",
  "user_profiles!resident_monitoring_orders_entered_by_fkey(full_name)",
].join(", ");

const RESIDENT_SELECT = [
  "id",
  "first_name",
  "last_name",
  "preferred_name",
  "beds!residents_bed_id_fkey(rooms(room_number))",
].join(", ");

/** The four `status` values the table's CHECK allows. */
export const MONITORING_ORDER_OPEN_STATUS = "active";
export const MONITORING_ORDER_CLOSED_STATUSES = ["completed", "cancelled", "expired"] as const;

export type MonitoringOrderListRow = {
  id: string;
  facility_id: string;
  resident_id: string;
  interval_minutes: number;
  starts_at: string;
  ends_at: string | null;
  review_due_at: string | null;
  ordered_by_type: string;
  ordered_by_name: string;
  order_received_as: string;
  reason_category: string;
  reason_note: string;
  status: string;
  cancel_reason: string | null;
  cancelled_at: string | null;
  closed_at: string | null;
  user_profiles: { full_name: string | null } | null;
};

export type MonitoringOrderResident = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  beds: { rooms: { room_number: string | null } | null } | null;
};

export async function fetchActiveMonitoringOrders(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<MonitoringOrderListRow[]> {
  const { data, error } = await supabase
    .from("resident_monitoring_orders")
    .select(ORDER_SELECT)
    .eq("facility_id", facilityId)
    .eq("status", MONITORING_ORDER_OPEN_STATUS)
    .is("deleted_at", null)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MonitoringOrderListRow[];
}

export async function fetchClosedMonitoringOrders(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<MonitoringOrderListRow[]> {
  const { data, error } = await supabase
    .from("resident_monitoring_orders")
    .select(ORDER_SELECT)
    .eq("facility_id", facilityId)
    .in("status", MONITORING_ORDER_CLOSED_STATUSES)
    .is("deleted_at", null)
    .order("starts_at", { ascending: false })
    .limit(CLOSED_ORDER_LIMIT);
  if (error) throw error;
  return (data ?? []) as unknown as MonitoringOrderListRow[];
}

/**
 * Residents behind a set of orders, read with the proven bed-to-room shape.
 * Scoped to the facility as well as to the ids, so a stale id list from a
 * previous building cannot pull a name across buildings.
 */
export async function fetchMonitoringOrderResidents(
  supabase: SupabaseClient,
  facilityId: string,
  residentIds: readonly string[],
): Promise<MonitoringOrderResident[]> {
  if (residentIds.length === 0) return [];
  const { data, error } = await supabase
    .from("residents")
    .select(RESIDENT_SELECT)
    .eq("facility_id", facilityId)
    .in("id", Array.from(new Set(residentIds)))
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as unknown as MonitoringOrderResident[];
}

export async function cancelMonitoringOrder(
  supabase: SupabaseClient,
  orderId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("cancel_monitoring_order", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw error;
}
