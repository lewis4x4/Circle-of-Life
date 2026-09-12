/**
 * officer-catalog: Front Office capability federation, Haven target.
 * Contract: front-office-capability-v1 (Front Office docs/specs/0004-CAPABILITY-FEDERATION.md).
 * Design and operator notes: docs/specs/OFFICER-CAPABILITY-CATALOG.md.
 *
 * Gateway JWT verification is off (supabase/config.toml). The x-fo-* HMAC is
 * the caller's identity; see handler.ts for the full pipeline.
 */
import { handleOfficerCatalogRequest, serviceRpc } from "./handler.ts";

const rpc = serviceRpc(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

Deno.serve((request: Request) =>
  handleOfficerCatalogRequest(request, {
    rpc,
    // The database names the secret; only its value is read here, by name.
    getSecret: (name: string) => Deno.env.get(name),
  })
);
