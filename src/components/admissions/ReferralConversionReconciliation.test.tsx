import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import { ReferralConversionReconciliation, reconciliationHref, reconciliationLine } from "./ReferralConversionReconciliation";

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

describe("Referral conversions to review (COL-333)", () => {
  it("lists each kind in plain words with a link, for the facility asked", async () => {
    rpc.mockResolvedValue({
      data: [
        { kind: "converted_without_arrival", facility_id: "f", referral_lead_id: "lead-1", admission_case_id: null, at: null },
        { kind: "move_in_without_arrival", facility_id: "f", referral_lead_id: null, admission_case_id: "case-1", at: null },
        { kind: "move_in_without_arrival", facility_id: "f", referral_lead_id: null, admission_case_id: "case-2", at: null },
      ],
      error: null,
    });
    render(<ReferralConversionReconciliation facilityId="f" />);
    expect(await screen.findByText("1 referral is marked moved in with no confirmed arrival behind it.")).toBeTruthy();
    expect(screen.getByText("2 admissions are at move-in with no confirmed arrival (the old status path).")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the referral" }).getAttribute("href")).toBe("/admin/referrals/lead-1");
    expect(rpc).toHaveBeenCalledWith("referral_conversion_reconciliation", { p_facility: "f" });
  });

  it("shows nothing when there is nothing to review or the reader is not an administrator", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const { container } = render(<ReferralConversionReconciliation facilityId="f" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe("");
  });

  it("links an arrived admission to the admission", () => {
    expect(reconciliationHref({ kind: "arrived_referral_open", facility_id: "f", referral_lead_id: "l", admission_case_id: "c", at: null })).toBe("/admin/admissions/c");
    expect(reconciliationLine("arrived_referral_open", 3)).toBe("3 admissions arrived while their referrals are still open.");
  });
});
