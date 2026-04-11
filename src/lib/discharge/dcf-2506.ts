/**
 * DCF Form 2506 coordination for Medicaid discharges (Florida).
 */

import type { HandoffDischargeReason } from "@/lib/discharge/notice-periods";

export function requiresDcf2506Workflow(reason: HandoffDischargeReason): boolean {
  return reason === "medicaid_relocation";
}

export type Dcf2506StepStatus = "not_started" | "in_progress" | "submitted" | "waived";

export interface Dcf2506WorkflowStub {
  required: boolean;
  /** Placeholder for workflow engine / tasks integration */
  status: Dcf2506StepStatus;
}

export function buildDcf2506Stub(reason: HandoffDischargeReason): Dcf2506WorkflowStub {
  const required = requiresDcf2506Workflow(reason);
  return {
    required,
    status: required ? "not_started" : "waived",
  };
}
