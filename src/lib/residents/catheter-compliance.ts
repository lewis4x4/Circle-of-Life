import type { CatheterFlag } from "@/types/resident-profile-contracts";

export type CatheterComplianceStatus = "ok" | "ack_required" | "not_applicable";

export function catheterComplianceStatus(flag: CatheterFlag): CatheterComplianceStatus {
  if (!flag.hasCatheter) return "not_applicable";
  if (!flag.acknowledgmentSigned) return "ack_required";
  return "ok";
}

export function catheterComplianceCopy(flag: CatheterFlag): string | null {
  if (catheterComplianceStatus(flag) !== "ack_required") return null;
  return (
    "Catheter care acknowledgment is not signed. Document resident/family acknowledgment that " +
    "routine catheter changes are not provided unless specifically included in the service agreement."
  );
}
