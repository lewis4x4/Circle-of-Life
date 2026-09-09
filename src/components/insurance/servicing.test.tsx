import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicingEditor } from "./servicing-editor";
import {
  ServicingRecordSummary,
  TransitionForm,
  ReassignmentForm,
  ServicingDetailPage,
  ServicingListPage,
  ServicingPrintPage,
} from "./servicing-pages";
import { LegacyInsuranceGuard } from "./servicing-client";
import {
  createEmptyServicingPayload,
  SERVICING_KINDS,
  type ServicingKind,
  type ServicingRecord,
  type ServicingWorkspace,
} from "@/lib/insurance/servicing-types";
import { parseServicingCommand } from "@/lib/insurance/servicing-schema";
import {
  documentFixture,
  entityId,
  facilityId,
  policyId,
} from "./test-support/fixtures";
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  id: "77777777-7777-4777-8777-777777777777",
  kind: "renewal_package",
  version: "1",
}));
const auth = vi.hoisted(() => ({
  loading: false,
  organizationId: "org",
  appRole: "owner",
  user: { id: "owner" },
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: navigation.id }),
  useRouter: () => navigation,
  usePathname: () => "/admin/insurance/servicing",
  useSearchParams: () =>
    new URLSearchParams(
      `kind=${navigation.kind}&version=${navigation.version}`,
    ),
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
function workspace(): ServicingWorkspace {
  const metric = {
    known_subtotal_cents: 0,
    missing_count: 0,
    total_cents: null,
  };
  return {
    records: [],
    entities: [{ id: entityId, name: "Example ALF LLC" }],
    facilities: [{ id: facilityId, name: "Example ALF", entity_id: entityId }],
    policies: [
      {
        id: policyId,
        entity_id: entityId,
        policy_number: "GL-123",
        carrier_name: "Example carrier",
        policy_type: "general_liability",
        verification_status: "verified",
        version: 2,
      },
    ],
    documents: [documentFixture()],
    owners: [{ id: entityId, name: "Insurance owner" }],
    vendors: [{ id: entityId, name: "Example vendor" }],
    contracts: [
      { id: policyId, vendor_id: entityId, title: "Example contract" },
    ],
    loss_totals: {
      paid_cents: metric,
      reserve_cents: metric,
      recovery_cents: metric,
      expense_cents: metric,
      incurred_cents: metric,
      claim_count: 0,
      history_complete: false,
    },
  };
}
function record(kind: ServicingKind = "renewal_package"): ServicingRecord {
  return {
    id: navigation.id,
    organization_id: entityId,
    entity_id: entityId,
    facility_id: null,
    policy_id: null,
    document_id: null,
    title: "Example servicing record",
    status: "draft",
    version: 1,
    owner_id: null,
    due_date: null,
    source_record_id: null,
    superseded_by: null,
    event_metadata: {},
    reviewed_by: null,
    reviewed_at: null,
    created_by: entityId,
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
    kind,
    payload: createEmptyServicingPayload(kind),
  } as ServicingRecord;
}
beforeEach(() => {
  auth.loading = false;
  auth.appRole = "owner";
  auth.organizationId = "org";
  navigation.kind = "renewal_package";
  navigation.version = "1";
  vi.stubGlobal("fetch", vi.fn());
});
describe("Servicing domain drafts", () => {
  it.each(SERVICING_KINDS)(
    "creates a valid partial %s through named controls",
    async (kind) => {
      const onSaved = vi.fn();
      vi.mocked(fetch).mockResolvedValue(
        Response.json({ record: record(kind) }),
      );
      render(
        <ServicingEditor
          kind={kind}
          workspace={workspace()}
          onSaved={onSaved}
        />,
      );
      fireEvent.change(screen.getByLabelText("Record title"), {
        target: { value: "Working servicing draft" },
      });
      fireEvent.change(screen.getByLabelText("Legal entity"), {
        target: { value: entityId },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Save servicing draft" }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      const command = JSON.parse(
        vi.mocked(fetch).mock.calls[0][1]!.body as string,
      );
      expect(() => parseServicingCommand(command)).not.toThrow();
      expect(command.payload.kind).toBe(kind);
      expect(command.payload).not.toHaveProperty("organization_id");
      expect(
        screen.queryByRole("textbox", { name: /json/i }),
      ).not.toBeInTheDocument();
    },
  );
  it("projects a SQL-shaped package without forging its policy snapshot or record metadata", async () => {
    const r = record("renewal_package") as ServicingRecord<"renewal_package">;
    r.payload.policy_snapshot = {
      id: policyId,
      version: 2,
      carrier_name: "Example carrier",
    };
    r.event_metadata = { action: "save", actor: "owner" };
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ record: { ...r, version: 2 } }),
    );
    render(
      <ServicingEditor
        kind="renewal_package"
        record={r}
        workspace={workspace()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save servicing draft" }),
    );
    await screen.findByText(
      "Draft saved. It is not an approved insurance record.",
    );
    const command = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string,
    );
    expect(() => parseServicingCommand(command)).not.toThrow();
    expect(command.payload.payload).not.toHaveProperty("policy_snapshot");
    expect(command.payload).not.toHaveProperty("event_metadata");
    expect(command.payload.version).toBe(1);
  });
  it("retains edited facts after a stale-version conflict", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        { error: "Record changed in another session" },
        { status: 409 },
      ),
    );
    render(
      <ServicingEditor
        kind="claim_matter"
        record={record("claim_matter")}
        workspace={workspace()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Next servicing action"), {
      target: { value: "Request carrier reference" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save servicing draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Record changed in another session",
    );
    expect(screen.getByLabelText("Next servicing action")).toHaveValue(
      "Request carrier reference",
    );
  });
  it("requires explicit endorsement evidence controls for vendor requirements", () => {
    render(
      <ServicingEditor
        kind="vendor_evidence"
        workspace={workspace()}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.queryByLabelText("Endorsement evidence page"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /requirements need supporting policy/,
      }),
    );
    expect(
      screen.getByLabelText("Supporting endorsement or policy"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Endorsement evidence page"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Exception reason")).toBeInTheDocument();
  });
  it("preserves loss row identity and unknown amounts when a preceding row is removed", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ record: record("loss_report") }),
    );
    render(
      <ServicingEditor
        kind="loss_report"
        record={record("loss_report")}
        workspace={workspace()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add reported claim" }));
    fireEvent.click(screen.getByRole("button", { name: "Add reported claim" }));
    fireEvent.change(screen.getByLabelText("Claim 1 paid"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Claim 2 paid"), {
      target: { value: "20.50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove claim 1" }));
    expect(screen.getByLabelText("Claim 1 paid")).toHaveValue("20.50");
    fireEvent.click(
      screen.getByRole("button", { name: "Save servicing draft" }),
    );
    await screen.findByText(
      "Draft saved. It is not an approved insurance record.",
    );
    const command = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string,
    );
    expect(command.payload.payload.claims[0]).toMatchObject({
      paid_cents: 2050,
      reserve_cents: null,
      incurred_cents: null,
    });
    expect(() => parseServicingCommand(command)).not.toThrow();
  });
  it("keeps estimated and actual payroll in separate fields with source basis", () => {
    render(
      <ServicingEditor
        kind="workforce_exposure"
        workspace={workspace()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add exposure row" }));
    expect(
      screen.getByLabelText("Exposure 1 estimated payroll"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Exposure 1 actual payroll"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Exposure 1 basis note")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Manual exposure source reason"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/employee name/i)).not.toBeInTheDocument();
  });
});
describe("Servicing review and frozen records", () => {
  it("blocks review while edits are unsaved and requires reviewer confirmation", () => {
    const r = { ...record(), status: "review_required" as const };
    const view = render(<TransitionForm record={r} dirty refresh={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Approve reviewed record" }),
    ).toBeDisabled();
    view.rerender(
      <TransitionForm record={r} dirty={false} refresh={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Approve reviewed record" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the record/ }),
    );
    expect(
      screen.getByRole("button", { name: "Approve reviewed record" }),
    ).toBeEnabled();
  });
  it("records a manual sharing action with exact recipient and version without sending", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ record: { ...record(), status: "shared", version: 4 } }),
    );
    render(
      <TransitionForm
        record={{ ...record(), status: "approved", version: 3 }}
        dirty={false}
        refresh={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Exact handoff recipient"), {
      target: { value: "Named broker servicing contact" },
    });
    fireEvent.change(screen.getByLabelText("Action note"), {
      target: {
        value: "Operator delivered approved version3 through broker portal.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record completed handoff" }),
    );
    await screen.findByText("Action recorded in version history.");
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string),
    ).toMatchObject({
      action: "transition",
      payload: {
        version: 3,
        status: "shared",
        recipient: "Named broker servicing contact",
      },
    });
    expect(
      screen.getByText(/Haven does not send this record/),
    ).toBeInTheDocument();
  });
  it("keeps acknowledgment/reporting data in an event command, outside frozen claim payload", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ record: record("claim_matter") }),
    );
    render(
      <TransitionForm
        record={{ ...record("claim_matter"), status: "shared", version: 4 }}
        dirty={false}
        refresh={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Exact handoff recipient"), {
      target: { value: "Carrier intake" },
    });
    fireEvent.change(
      screen.getByLabelText("Recipient acknowledgment evidence"),
      { target: { value: "Carrier acknowledgment ref100" } },
    );
    fireEvent.change(screen.getByLabelText("Recorded reporting date"), {
      target: { value: "2026-09-09" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record recipient acknowledgment" }),
    );
    await screen.findByText("Action recorded in version history.");
    const command = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string,
    );
    expect(command.payload).toMatchObject({
      reported_date: "2026-09-09",
      acknowledgment: "Carrier acknowledgment ref100",
    });
    expect(command.payload).not.toHaveProperty("payload");
  });
  it("renders frozen approval with revision and approved export actions rather than an editor", async () => {
    const w = workspace();
    w.records = [{ ...record(), status: "approved", version: 3 }];
    vi.mocked(fetch).mockResolvedValue(Response.json(w));
    render(<ServicingDetailPage />);
    expect(
      await screen.findByRole("button", { name: "Create new revision" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Record title")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download approved package file" }),
    ).toHaveAttribute(
      "href",
      `/api/insurance/servicing/${navigation.id}/export?version=3`,
    );
  });
  it.each(SERVICING_KINDS)(
    "provides human-readable %s summary without raw JSON",
    (kind) => {
      render(
        <ServicingRecordSummary
          record={record(kind)}
          workspace={workspace()}
        />,
      );
      expect(
        screen.getByRole("heading", { name: "Example servicing record" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByText(/policy_snapshot/)).not.toBeInTheDocument();
    },
  );
  it("shows null-aware loss totals instead of converting incomplete figures to zero", async () => {
    navigation.kind = "loss_report";
    const w = workspace();
    w.loss_totals.paid_cents = {
      known_subtotal_cents: 10000,
      missing_count: 1,
      total_cents: null,
    };
    vi.mocked(fetch).mockResolvedValue(Response.json(w));
    render(<ServicingListPage />);
    expect(
      await screen.findByText(
        "Known subtotal $100.00; 1 unknown claim value(s).",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Reporting history is incomplete/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });
  it("does not mount a sensitive legacy register for facility roles", () => {
    auth.appRole = "facility_admin";
    const mount = vi.fn();
    function Sensitive() {
      mount();
      return <p>Confidential legacy claims</p>;
    }
    render(
      <LegacyInsuranceGuard>
        <Sensitive />
      </LegacyInsuranceGuard>,
    );
    expect(mount).not.toHaveBeenCalled();
    expect(
      screen.getByText(/register is restricted to insurance managers/),
    ).toBeInTheDocument();
  });
});

it("uses prepared display names and frozen policy schedules after directory names change", () => {
  const r = record("renewal_package") as ServicingRecord<"renewal_package">;
  r.status = "approved";
  r.display_names = { entity: "Prepared legal name", owner: "Prepared owner" };
  r.owner_id = entityId;
  r.payload.policy_snapshot = {
    policy_number: "GL-123",
    carrier_name: "Prepared carrier",
    version: 2,
    effective_date: "2026-01-01",
    expiration_date: "2027-01-01",
    premium_cents: 125000,
    shared_limit: true,
    parties: [
      {
        entity_id: entityId,
        entity_name: "Prepared party",
        role: "primary_named_insured",
        effective_from: "2026-01-01",
        effective_to: null,
      },
    ],
    facilities: [
      {
        facility_id: facilityId,
        facility_name: "Prepared location",
        role: "scheduled_location",
        effective_from: "2026-01-01",
        effective_to: null,
      },
    ],
  };
  const w = workspace();
  w.entities[0].name = "Renamed current legal entity";
  w.facilities[0].name = "Renamed current facility";
  render(<ServicingRecordSummary record={r} workspace={w} />);
  expect(screen.getByText("Prepared legal name")).toBeInTheDocument();
  expect(screen.getByText("Prepared owner")).toBeInTheDocument();
  expect(
    screen.getByText(/Prepared party · primary named insured/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Prepared location · scheduled location/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Renamed current legal entity"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("$1,250.00")).toBeInTheDocument();
});

it("rejects overflowing monetary entry before it can become a null JSON amount", () => {
  const dirty = vi.fn();
  render(
    <ServicingEditor
      kind="loss_report"
      record={record("loss_report")}
      workspace={workspace()}
      onSaved={vi.fn()}
      onDirty={dirty}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add reported claim" }));
  dirty.mockClear();
  const input = screen.getByLabelText("Claim 1 paid") as HTMLInputElement;
  fireEvent.change(input, {
    target: { value: "999999999999999999999999999999999999999999" },
  });
  expect(input.checkValidity()).toBe(false);
  expect(input.validationMessage).toContain("$21,474,836.47");
  expect(dirty).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Save servicing draft" }));
  expect(fetch).not.toHaveBeenCalled();
});

it("reassigns an approved record after a former assignee leaves without rewriting prepared ownership", async () => {
  const r = record();
  r.status = "approved";
  r.owner_id = "88888888-8888-4888-8888-888888888888";
  r.display_names = { owner: "Former owner at preparation" };
  const w = workspace();
  w.records = [r];
  vi.mocked(fetch).mockImplementation((_url, init) =>
    Promise.resolve(
      Response.json(
        init?.method === "POST"
          ? { record: { ...r, owner_id: entityId, version: 2 } }
          : w,
      ),
    ),
  );
  render(<ServicingDetailPage />);
  expect(
    await screen.findByText("Former owner at preparation"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Former assignee is inactive or unavailable/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Current operational owner"), {
    target: { value: entityId },
  });
  fireEvent.change(screen.getByLabelText("Operational due date"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("Assignment change reason"), {
    target: {
      value: "Former owner left; current reviewer takes responsibility.",
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Record assignment change" }),
  );
  await screen.findByText(
    "Operational assignment recorded in history. Prepared package details are unchanged.",
  );
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([, init]) => init?.method === "POST")!;
  const command = JSON.parse(call[1]!.body as string);
  expect(command).toMatchObject({
    action: "reassign",
    payload: { version: 1, owner_id: entityId, due_date: "2026-10-01" },
  });
  expect(command.payload).not.toHaveProperty("display_names");
  expect(command.payload).not.toHaveProperty("payload");
});
it("retains reassignment reason and selection on version conflict", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "Assignment version changed" }, { status: 409 }),
  );
  render(
    <ReassignmentForm
      record={record()}
      workspace={workspace()}
      dirty={false}
      refresh={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Current operational owner"), {
    target: { value: entityId },
  });
  fireEvent.change(screen.getByLabelText("Assignment change reason"), {
    target: { value: "New reviewer" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Record assignment change" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Assignment version changed",
  );
  expect(screen.getByLabelText("Assignment change reason")).toHaveValue(
    "New reviewer",
  );
  expect(screen.getByLabelText("Current operational owner")).toHaveValue(
    entityId,
  );
});
it("links an incident using dated facility choices without clinical identity fields", async () => {
  const w = workspace();
  w.incidents = [
    {
      id: policyId,
      facility_id: facilityId,
      incident_type: "fall",
      occurred_at: "2026-09-09T12:30:00Z",
    },
  ];
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ record: record("claim_matter") }),
  );
  render(
    <ServicingEditor
      kind="claim_matter"
      record={record("claim_matter")}
      workspace={w}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Facility scope"), {
    target: { value: facilityId },
  });
  expect(
    screen.getByRole("option", { name: /Sep 9, 2026.*fall.*Example ALF/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: /incident ID/i }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Proposed incident"), {
    target: { value: policyId },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save servicing draft" }));
  await screen.findByText(
    "Draft saved. It is not an approved insurance record.",
  );
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).payload
      .payload.incident_id,
  ).toBe(policyId);
});

it("edits and resubmits an in-review record without a redundant status transition", async () => {
  const r = { ...record(), status: "review_required" as const };
  const saved = { ...r, version: 2 };
  vi.mocked(fetch).mockResolvedValue(Response.json({ record: saved }));
  const onSaved = vi.fn();
  render(
    <ServicingEditor
      kind="renewal_package"
      workspace={workspace()}
      record={r}
      onSaved={onSaved}
    />,
  );
  fireEvent.change(screen.getByLabelText("Open questions for the broker"), {
    target: { value: "Confirm the revised schedule" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save and request review" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).action,
  ).toBe("save");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("selects a shared policy and location for its approved additional insured", async () => {
  const additional = "99999999-9999-4999-8999-999999999999";
  const w = workspace();
  w.entities.push({ id: additional, name: "Approved additional insured LLC" });
  w.policies[0].insured_entity_ids = [entityId, additional];
  w.policies[0].covered_facility_ids = [facilityId];
  vi.mocked(fetch).mockResolvedValue(Response.json({ record: record() }));
  render(
    <ServicingEditor kind="renewal_package" workspace={w} onSaved={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText("Record title"), {
    target: { value: "Shared package" },
  });
  fireEvent.change(screen.getByLabelText("Legal entity"), {
    target: { value: additional },
  });
  fireEvent.change(screen.getByLabelText("Related policy"), {
    target: { value: policyId },
  });
  expect(
    screen.getByRole("option", { name: "Example ALF" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Facility scope"), {
    target: { value: facilityId },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save servicing draft" }));
  await screen.findByText(
    "Draft saved. It is not an approved insurance record.",
  );
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).payload,
  ).toMatchObject({
    entity_id: additional,
    policy_id: policyId,
    facility_id: facilityId,
  });
});

it("keeps explicitly unassigned preparation ownership frozen in print after reassignment and directory rename", async () => {
  const r = record("renewal_package");
  r.status = "approved";
  r.display_names = { owner: null };
  r.owner_id = null;
  const w = workspace();
  w.records = [r];
  vi.mocked(fetch).mockResolvedValue(Response.json(w));
  const view = render(<ServicingPrintPage />);
  await screen.findByRole("button", { name: "Print approved package" });
  expect(
    screen.getByText("Owner at preparation").parentElement?.querySelector("dd"),
  ).toHaveTextContent("Unassigned");
  view.unmount();
  r.owner_id = entityId;
  w.owners[0].name = "Renamed current operational owner";
  vi.mocked(fetch).mockResolvedValue(Response.json(w));
  render(<ServicingPrintPage />);
  await screen.findByRole("button", { name: "Print approved package" });
  expect(
    screen.getByText("Owner at preparation").parentElement?.querySelector("dd"),
  ).toHaveTextContent("Unassigned");
  expect(
    screen.queryByText(/Renamed current operational owner/),
  ).not.toBeInTheDocument();
});
