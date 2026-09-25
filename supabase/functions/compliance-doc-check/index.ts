/**
 * Legacy insurance triage is withheld until the shared intake rollout (COL-819).
 * A cron secret proves the caller, not the document sender or source. Neither
 * caller text nor a vault category supplies the adopted whole-obligation gate.
 * Keep the endpoint for explicit refusal and preserve historical triage rows.
 */
import { handleComplianceRequest } from "./request.ts";

Deno.serve((req) => handleComplianceRequest(req, Deno.env.get("COMPLIANCE_DOC_CHECK_SECRET")));
