import { z } from "zod";

/** Canonical PostgreSQL UUID text, including deployed legacy IDs with zero
 * version/variant bits. Format validation is not an authorization decision.
 * Request/correlation tokens keep their own generation-specific contracts.
 */
export const databaseUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid UUID",
);
