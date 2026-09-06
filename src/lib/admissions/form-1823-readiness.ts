import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
export function isForm1823Current(record: { status: string; physician_name: string | null; exam_date: string | null; expiration_date: string | null } | null | undefined, evidence: { received_at?: string | null; notes?: string | null } | null | undefined, today = todayFacilityDateIso()): boolean {
 return Boolean(record?.status === "received" && evidence?.received_at && evidence.notes?.trim() && record.physician_name?.trim() && record.exam_date && record.exam_date <= today && record.expiration_date && record.expiration_date >= today && record.expiration_date >= record.exam_date);
}
