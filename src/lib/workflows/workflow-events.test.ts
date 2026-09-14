import { describe, expect, it, vi } from "vitest";

import { syncLeadToApplicationPending } from "@/lib/workflows/workflow-events";

function referralModel(status: string, revision: string) {
  return {
    episode: {
      id: "lead",
      status,
      episode_revision: revision,
    },
    contacts: [],
  };
}

describe("admission referral reconciliation", () => {
  it("records application pending through the revisioned referral command", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: referralModel("new", "a".repeat(64)), error: null })
      .mockResolvedValueOnce({
        data: {
          episode_id: "lead",
          episode_revision: "b".repeat(64),
          status: "application_pending",
          work_state: "unassigned",
          event_id: "event",
          event_kind: "admission_transition",
          replayed: false,
        },
        error: null,
      });
    const client = { rpc } as never;

    await syncLeadToApplicationPending(client, {
      leadId: "lead",
      admissionCaseId: "admission",
    });

    expect(rpc).toHaveBeenNthCalledWith(2, "referral_episode_command", {
      p_episode_id: "lead",
      p_request_key: "admission:admission:application-pending",
      p_expected_revision: "a".repeat(64),
      p_command: "admission_transition",
      p_payload: {
        admission_case_id: "admission",
        target_status: "application_pending",
      },
    });
  });

  it("does not regress an already advanced referral", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: referralModel("waitlisted", "a".repeat(64)),
      error: null,
    });

    await syncLeadToApplicationPending({ rpc } as never, {
      leadId: "lead",
      admissionCaseId: "admission",
    });

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
