import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });
const date = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const identifier = z.string().min(1).max(200);

/** Display allowlist only. Source page/body validation belongs to the receiver. */
export const agencySummaryProjectionSchema = z.object({
  live_connection_enabled: z.literal(false),
  connections: z.array(
    z.object({
      id: identifier,
      name: z.string(),
      provider_instance: z.string(),
      source_integration_id: identifier,
      mode: z.literal("synthetic"),
      enabled: z.boolean(),
      state: z.enum(["disabled", "healthy", "degraded", "unavailable"]),
      revision: z.number().int().nonnegative(),
      last_authorization_check_at: timestamp.nullable(),
      authorization_valid_until: timestamp.nullable(),
      incomplete_summary_count: z.number().int().nonnegative(),
      summaries: z.array(
        z.object({
          source_policy_id: identifier,
          release_id: identifier,
          source_sequence: z.string().regex(/^(0|[1-9][0-9]*)$/),
          source_released_at: timestamp,
          received_at: timestamp,
          mapped_entity_id: identifier,
          mapped_entity_name: z.string(),
          summary: z.object({
            policy_number: z.string(),
            carrier: z.string().nullable(),
            line_of_business: z.string().nullable(),
            named_insured: z.string().nullable(),
            effective_date: date.nullable(),
            expiration_date: date.nullable(),
            premium: z.number().finite().nullable(),
            status: z.string().nullable(),
          }),
        }),
      ),
    }),
  ),
});

export const agencySummaryResponseSchema = agencySummaryProjectionSchema.extend(
  {
    read_at: timestamp,
  },
);
export type AgencySummaryResponse = z.infer<typeof agencySummaryResponseSchema>;
export type AgencyConnection = AgencySummaryResponse["connections"][number];
export type AgencySummary = AgencyConnection["summaries"][number];

export function connectionMayDisplay(connection: AgencyConnection): boolean {
  return (
    connection.enabled &&
    connection.mode === "synthetic" &&
    ["healthy", "degraded"].includes(connection.state) &&
    connection.last_authorization_check_at !== null &&
    connection.authorization_valid_until !== null
  );
}
