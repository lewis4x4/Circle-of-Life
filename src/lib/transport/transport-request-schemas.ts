import { z } from "zod";

export const transportTypeSchema = z.enum(["facility_vehicle", "staff_personal_vehicle", "third_party"]);

export const transportRequestStatusSchema = z.enum([
  "requested",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

export const residentTransportRequestCreateSchema = z.object({
  resident_id: z.string().uuid(),
  transport_type: transportTypeSchema,
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointment_time: z.string().max(12).optional().nullable(),
  destination_name: z.string().min(1).max(500).trim(),
  destination_address: z.string().max(500).trim().optional().nullable(),
  purpose: z.string().min(1).max(500).trim(),
  wheelchair_required: z.boolean(),
  escort_required: z.boolean(),
  notes: z.string().max(2000).optional().nullable(),
});

const uuidOrNull = z
  .union([z.literal(""), z.string().uuid()])
  .transform((s) => (s === "" ? null : s));

export const residentTransportRequestUpdateSchema = z.object({
  transport_type: transportTypeSchema,
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointment_time: z.string().max(12).optional().nullable(),
  destination_name: z.string().min(1).max(500).trim(),
  destination_address: z.string().max(500).trim().optional().nullable(),
  purpose: z.string().min(1).max(500).trim(),
  wheelchair_required: z.boolean(),
  escort_required: z.boolean(),
  escort_staff_id: uuidOrNull,
  vehicle_id: uuidOrNull,
  driver_staff_id: uuidOrNull,
  pickup_time: z.string().max(12).optional().nullable(),
  return_time: z.string().max(12).optional().nullable(),
  status: transportRequestStatusSchema,
  cancellation_reason: z.string().max(1000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const mileageLogLinkSchema = z.object({
  origin: z.string().min(1).max(500).trim(),
  destination: z.string().min(1).max(500).trim(),
  miles: z.coerce.number().positive().max(99999.9),
  round_trip: z.boolean(),
});

export function normalizeTimeForDb(v: string | null | undefined): string | null {
  if (v == null || v.trim() === "") return null;
  const t = v.trim();
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
  return null;
}
