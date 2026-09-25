import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OPERATING_RULE_COPY, type OperatingRuleSetting, type OperatingRulesSettingsLoad } from "@/lib/operating-rules/operating-rules-settings";
import type { OperatingRuleKey } from "@/lib/operating-rules/operating-rules";

import { OperatingRulesEditor } from "./OperatingRulesEditor";

const refresh = vi.fn();
const rpc = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

const TODAY = "2026-09-25";

function rule(key: OperatingRuleKey, current: unknown, extra: Partial<OperatingRuleSetting> = {}): OperatingRuleSetting {
  return { key, ...OPERATING_RULE_COPY[key], current, facilityOverrides: [], scheduled: [], history: [], ...extra };
}

function load(overrides: Partial<OperatingRulesSettingsLoad> = {}): OperatingRulesSettingsLoad {
  return {
    canEdit: true,
    canEditOrganization: true,
    facilities: [
      { id: "fac-homewood", name: "Homewood" },
      { id: "fac-oakridge", name: "Oakridge" },
    ],
    organizationId: "org-1",
    userId: "user-1",
    todayIso: TODAY,
    loadError: null,
    rules: [
      rule("stand_up.thursday_census_vs_monday", false),
      rule("stand_up.census_reason_options", [
        { key: "roster_not_current", label: "Roster not updated yet" },
        { key: "other", label: "Other" },
      ]),
    ],
    ...overrides,
  };
}

function card(name: string) {
  return within(screen.getByRole("region", { name }));
}

function record(scope: ReturnType<typeof card>) {
  fireEvent.change(scope.getByLabelText("Effective from"), { target: { value: "2026-10-01" } });
  fireEvent.change(scope.getByLabelText("Reason"), { target: { value: "Board ruling" } });
  fireEvent.click(scope.getByRole("button", { name: "Record change" }));
}

describe("OperatingRulesEditor (COL-555)", () => {
  beforeEach(() => {
    rpc.mockReset();
    refresh.mockReset();
    rpc.mockResolvedValue({ data: {}, error: null });
  });

  it("records a facility-scoped change through operating_rule_record", async () => {
    render(<OperatingRulesEditor load={load()} />);
    const thursday = card("Thursday census checked against Monday");
    fireEvent.change(thursday.getByLabelText("Applies to"), { target: { value: "fac-oakridge" } });
    fireEvent.click(thursday.getByRole("radio", { name: "On" }));
    record(thursday);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("operating_rule_record", {
        p_rule_key: "stand_up.thursday_census_vs_monday",
        p_facility_id: "fac-oakridge",
        p_value: true,
        p_effective_from: "2026-10-01",
        p_change_reason: "Board ruling",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("sends a null facility for the whole organization and words a scope refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "You cannot change this rule at that scope" } });
    render(<OperatingRulesEditor load={load()} />);
    const thursday = card("Thursday census checked against Monday");
    expect(thursday.getByLabelText("Applies to")).toHaveValue("organization");
    fireEvent.click(thursday.getByRole("radio", { name: "On" }));
    record(thursday);
    expect(await thursday.findByRole("alert")).toHaveTextContent("You cannot change this rule for that scope.");
    expect(rpc).toHaveBeenCalledWith("operating_rule_record", expect.objectContaining({ p_facility_id: null }));
  });

  it("does not offer Whole organization to a facility administrator", () => {
    render(<OperatingRulesEditor load={load({ canEditOrganization: false, facilities: [{ id: "fac-homewood", name: "Homewood" }] })} />);
    const thursday = card("Thursday census checked against Monday");
    const options = within(thursday.getByLabelText("Applies to")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Homewood"]);
    expect(thursday.queryByRole("option", { name: "Whole organization" })).toBeNull();
  });

  it("shows facility overrides and labels history rows by scope", () => {
    const history = [
      { id: "h2", ruleKey: "stand_up.thursday_census_vs_monday" as const, facilityId: "fac-homewood", value: true, effectiveFrom: "2026-09-20", changeReason: "Trial", createdAt: "2026-09-20T00:00:00Z" },
      { id: "h1", ruleKey: "stand_up.thursday_census_vs_monday" as const, facilityId: null, value: false, effectiveFrom: "2026-09-01", changeReason: "Seeded", createdAt: "2026-09-01T00:00:00Z" },
    ];
    render(
      <OperatingRulesEditor
        load={load({
          rules: [
            rule("stand_up.thursday_census_vs_monday", false, {
              history,
              facilityOverrides: [{ facilityId: "fac-homewood", facilityName: "Homewood", value: true, effectiveFrom: "2026-09-20" }],
            }),
          ],
        })}
      />,
    );
    const thursday = card("Thursday census checked against Monday");
    expect(thursday.getByText(/At Homewood/)).toBeInTheDocument();
    expect(thursday.getByText(/^Homewood, 2026-09-20: On:/)).toBeInTheDocument();
    expect(thursday.getByText(/^Organization, 2026-09-01: Off:/)).toBeInTheDocument();
  });

  it("edits the reason list and keys a new row from its label", async () => {
    render(<OperatingRulesEditor load={load()} />);
    const reasons = card("Stand Up census reasons");
    fireEvent.click(reasons.getByRole("button", { name: "Remove reason 1" }));
    fireEvent.click(reasons.getByRole("button", { name: "Add a reason" }));
    fireEvent.change(reasons.getByLabelText("Reason 2"), { target: { value: "Hospital hold not closed" } });
    fireEvent.change(reasons.getByLabelText("Applies to"), { target: { value: "fac-homewood" } });
    // Changing scope reloads that scope's value (Homewood has no override, so the organization list).
    expect(reasons.getAllByLabelText(/^Reason \d+$/).map((input) => (input as HTMLInputElement).value)).toEqual([
      "Roster not updated yet",
      "Other",
    ]);
    fireEvent.click(reasons.getByRole("button", { name: "Remove reason 1" }));
    fireEvent.click(reasons.getByRole("button", { name: "Add a reason" }));
    fireEvent.change(reasons.getByLabelText("Reason 2"), { target: { value: "Hospital hold not closed" } });
    record(reasons);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "operating_rule_record",
        expect.objectContaining({
          p_rule_key: "stand_up.census_reason_options",
          p_facility_id: "fac-homewood",
          p_value: [
            { key: "other", label: "Other" },
            { key: "hospital_hold_not_closed", label: "Hospital hold not closed" },
          ],
        }),
      ),
    );
  });
});
