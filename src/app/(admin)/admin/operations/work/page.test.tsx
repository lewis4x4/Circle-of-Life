import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceItem, WorkspaceReply } from "@/lib/operations/workspace";
import SiteWorkPage from "./page";
import { saveDraftBodySchema } from "@/lib/operations/recovery";

const env = vi.hoisted(() => ({
  actor: "11111111-1111-4111-8111-111111111111",
  name: "Dana Reyes",
  query: "facility_id=22222222-2222-4222-8222-222222222222&view=today",
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: env.replace }),
  useSearchParams: () => new URLSearchParams(env.query),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: { id: env.actor },
    fullName: env.name,
    appRole: "facility_admin",
    loading: false,
  }),
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: null,
    availableFacilities: [],
    facilitiesCacheUserId: null,
  }),
}));
vi.mock("@/lib/admin-facilities", () => ({
  fetchAdminFacilityOptions: async () => [
    { id: "22222222-2222-4222-8222-222222222222", name: "Homewood" },
  ],
}));

const facility = "22222222-2222-4222-8222-222222222222";
const task = "33333333-3333-4333-8333-333333333333";
const receiptId = "44444444-4444-4444-8444-444444444444";
const draftId = "55555555-5555-4555-8555-555555555555";
function item(name = "Check entrance"): WorkspaceItem {
  return {
    occurrence: {
      id: task,
      activity_id: null,
      activity_name: name,
      subject_id: null,
      subject_label: "Homewood",
      occurrence_kind: "scheduled",
      status: "pending",
      execution_state: "none",
      occurrence_revision: "old",
      effective_receipt_id: null,
      due_at: "2026-09-10T12:00:00Z",
      grace_ends_at: null,
      deadline_at: "2026-09-10T12:00:00Z",
      schedule_status: "scheduled",
      period_start_date: null,
      period_end_date: null,
      requirement_version_id: null,
      facility_requirement_id: null,
      authority_class: "facility",
    },
    rules: {
      inputs: [],
      evidence: [],
      recorder_roles: ["facility_admin"],
      review_required: false,
      can_record: true,
    },
    receipt: null,
    open_issues: 0,
    evidence_summary: { required_rules: 0, satisfied: true },
  };
}
function receipt(extra = {}) {
  return {
    id: receiptId,
    outcome: "performed",
    evidence_status_current: "not_required",
    evidence_satisfied_at: null,
    missing_evidence: [],
    receipt_kind: "performance",
    recorder_id: env.actor,
    recorded_at: "2026-09-10T15:00:00Z",
    completion_state: "completed",
    revision: "a".repeat(64),
    ...extra,
  };
}
function reply(rows = [item()]): WorkspaceReply {
  return {
    view: "today",
    facility_id: facility,
    facility_timezone: "America/New_York",
    generated_at: "2026-09-10T15:00:00Z",
    actor: { id: env.actor, name: env.name, role: "facility_admin" },
    partial: [],
    groups: {
      due_today: rows,
      outstanding: [],
      unknown_schedule: [],
      legacy: [],
    },
  };
}
function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
let snapshot: WorkspaceReply;
let commandReply: Record<string, unknown>;
let lost = false;
let savedInput: Record<string, unknown>;
type Network = (url: string, init?: RequestInit) => Promise<Response>;
let network: ReturnType<typeof vi.fn<Network>>;
beforeEach(() => {
  env.actor = "11111111-1111-4111-8111-111111111111";
  env.name = "Dana Reyes";
  env.query = `facility_id=${facility}&view=today`;
  env.replace.mockClear();
  snapshot = reply();
  commandReply = {
    receipt: receipt(),
    occurrence: { id: task, status: "completed", execution_state: "completed" },
    replayed: false,
  };
  lost = false;
  network = vi.fn<Network>(async (url: string, init?: RequestInit) => {
    if (url.includes("/workspace?")) return json(snapshot);
    if (url.endsWith("drafts?state=pending")) return json({ drafts: [] });
    if (url.endsWith("/drafts") && init?.method === "POST") {
      savedInput = saveDraftBodySchema.parse(JSON.parse(String(init.body)));
      return json({
        draft: {
          id: draftId,
          command: savedInput.command,
          target_id: task,
          request_key: savedInput.request_key,
          state: "pending",
          expires_at: null,
        },
        replayed: false,
      });
    }
    if (url.endsWith(`/drafts/${draftId}`))
      return json({
        outcome: "unsaved",
        draft: {
          id: draftId,
          command: "record_work",
          target_id: task,
          request_key: savedInput.request_key,
          state: "pending",
          expires_at: null,
        },
      });
    if (url.endsWith("/resume"))
      return json({
        outcome: "saved",
        draft: {
          id: draftId,
          command: "record_work",
          target_id: task,
          request_key: savedInput.request_key,
          state: "saved",
          expires_at: null,
        },
        reply: { ...commandReply, replayed: true },
      });
    if (url.endsWith("/receipts"))
      return json({
        receipts: [
          receipt(),
          receipt({
            id: "66666666-6666-4666-8666-666666666666",
            corrects_receipt_id: receiptId,
            correction_reason: "Correct reading",
          }),
        ],
      });
    if (url.includes("/evidence?")) return json({ evidence: [] });
    if (url.includes("/issues?")) return json({ issues: [] });
    if (init?.method === "POST") {
      if (lost) throw new Error("lost response");
      return json(commandReply);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", network);
});

describe("Site work", () => {
  it("completes routine work once, updates in place, preserves URL and focus", async () => {
    render(<SiteWorkPage />);
    const button = await screen.findByRole("button", {
      name: "Complete",
    });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText("Receipt state: completed")).toBeVisible();
    const commands = network.mock.calls.filter(([url]) =>
      url.endsWith("/record"),
    );
    expect(commands).toHaveLength(1);
    expect(JSON.parse(String(commands[0][1]?.body))).toEqual({
      request_key: expect.any(String),
      payload: { outcome: "performed" },
    });
    expect(
      network.mock.calls.filter(([url]) => url.includes("/workspace?")),
    ).toHaveLength(1);
    expect(env.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toHaveFocus());
    expect(screen.getByText(/Recorded by Dana Reyes/)).toBeVisible();
  });
  it("renders exactly published typed fields and keeps empty dates empty", async () => {
    const row = item();
    row.rules!.inputs = [
      {
        key: "temperature",
        label: "Temperature",
        type: "number",
        required: true,
        min: 0,
        max: 50,
        unit: "C",
      },
      { key: "observed", label: "Observed", type: "datetime", required: false },
    ];
    snapshot = reply([row]);
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Record work" }),
    );
    expect(screen.getByLabelText("Temperature (C) (required)")).toHaveAttribute(
      "type",
      "number",
    );
    expect(screen.getByLabelText("Date")).toHaveValue("");
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Outcome")).not.toBeInTheDocument();
  });
  it("shows evidence only after a missing-evidence receipt and keeps it unfinished", async () => {
    const row = item();
    row.rules!.evidence = [
      {
        kind: "photo",
        label: "Entrance photo",
        min_count: 1,
        when: "on_success",
      },
    ];
    snapshot = reply([row]);
    commandReply = {
      receipt: receipt({
        evidence_status_current: "missing",
        completion_state: "performed_missing_evidence",
        missing_evidence: row.rules!.evidence,
      }),
      occurrence: {
        status: "in_progress",
        execution_state: "performed_missing_evidence",
      },
      replayed: false,
    };
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Record work" }),
    );
    expect(screen.queryByText("Entrance photo")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save work" }));
    expect(
      await screen.findByText("Receipt state: performed_missing_evidence"),
    ).toBeVisible();
    expect(screen.getByLabelText("File for Entrance photo")).toBeVisible();
  });
  it("keeps old outstanding and unknown schedule work visible", async () => {
    const old = item("Old overdue");
    old.occurrence.id = "old";
    old.occurrence.deadline_at = "2000-01-01T12:00:00Z";
    const unknown = item("Unscheduled check");
    unknown.occurrence.id = "unknown";
    unknown.occurrence.deadline_at = null;
    unknown.occurrence.schedule_status = "unknown";
    snapshot = {
      ...reply([]),
      groups: {
        due_today: [],
        outstanding: [old],
        unknown_schedule: [unknown],
        legacy: [],
      },
    };
    render(<SiteWorkPage />);
    expect(await screen.findByText("Old overdue")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Record unscheduled work" }),
    ).toBeVisible();
  });
  it("retries lost answers through the same server draft and restores focus", async () => {
    lost = true;
    render(<SiteWorkPage />);
    const button = await screen.findByRole("button", {
      name: "Complete",
    });
    await userEvent.click(button);
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry the same save" }),
    );
    expect(await screen.findByText(/Recorded by.*already saved/)).toBeVisible();
    await waitFor(() => expect(button).toHaveFocus());
    expect(
      network.mock.calls.filter(([url]) => url.endsWith("/drafts")),
    ).toHaveLength(1);
    expect(
      network.mock.calls.filter(([url]) => url.endsWith("/record")),
    ).toHaveLength(1);
    expect(
      network.mock.calls.filter(([url]) => url.endsWith("/resume")),
    ).toHaveLength(1);
  });
  it("reports an issue and changes only the issue count", async () => {
    commandReply = {
      issue: { id: "issue-1", status: "open" },
      replayed: false,
    };
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Report an issue" }),
    );
    await userEvent.type(screen.getByLabelText("Issue summary"), "Loose rail");
    await userEvent.click(screen.getByRole("button", { name: "Save issue" }));
    expect(await screen.findByText("Open issues: 1")).toBeVisible();
    expect(screen.getByText("Status: pending · none")).toBeVisible();
    expect(
      network.mock.calls.filter(([url]) => url.includes("/workspace?")),
    ).toHaveLength(1);
  });
  it("shows corrected history and sends receipt identity and reason for reversal", async () => {
    env.query = `facility_id=${facility}&view=history`;
    const row = item();
    row.receipt = receipt();
    row.occurrence.status = "completed";
    snapshot = {
      ...reply(),
      view: "history",
      groups: { history: [row], total: 101, next_cursor: "next" },
    };
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "View receipt history" }),
    );
    expect(await screen.findByText(/Corrects receipt/)).toBeVisible();
    expect(
      screen.getByText("101 total entries across this site"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Correct" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Reverse" }));
    await userEvent.type(screen.getByLabelText("Reason"), "Wrong occurrence");
    await userEvent.click(
      screen.getByRole("button", { name: "Save reversal" }),
    );
    await waitFor(() =>
      expect(network.mock.calls.some(([url]) => url.endsWith("/reverse"))).toBe(
        true,
      ),
    );
    const call = network.mock.calls.find(([url]) => url.endsWith("/reverse"))!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      expected_receipt_id: receiptId,
      expected_receipt_revision: "a".repeat(64),
      payload: { reason: "Wrong occurrence" },
    });
  });
  it("retains next-page navigation on an empty Mine page", async () => {
    env.query = `facility_id=${facility}&view=history&mine=1`;
    snapshot = {
      ...reply(),
      view: "history",
      groups: { history: [], total: 101, next_cursor: "opaque" },
    };
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Next page" }),
    );
    expect(env.replace).toHaveBeenCalledWith(
      expect.stringContaining("cursor=opaque"),
      { scroll: false },
    );
    expect(
      screen.getByText(/101 total entries across this site/),
    ).toBeVisible();
  });
  it("removes the previous person's recording surface immediately", async () => {
    const view = render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Report an issue" }),
    );
    await userEvent.type(
      screen.getByLabelText("Issue summary"),
      "Private draft",
    );
    env.actor = "99999999-9999-4999-8999-999999999999";
    env.name = "New Person";
    snapshot = reply();
    network.mockImplementation(() => new Promise<Response>(() => {}));
    view.rerender(<SiteWorkPage />);
    expect(screen.queryByDisplayValue("Private draft")).not.toBeInTheDocument();
    expect(screen.queryByText(/Dana Reyes/)).not.toBeInTheDocument();
  });
  it("passes axe with real page primitives and rendered recording controls", async () => {
    const { container } = render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Report an issue" }),
    );
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
    expect(
      within(screen.getByRole("main")).getByLabelText("Issue summary"),
    ).toBeVisible();
  });
  it("cancels a failed draft back to the exact one-action performed payload", async () => {
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "More options" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Outcome"), "failed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete" }));
    await screen.findByText("Receipt state: completed");
    expect(
      JSON.parse(
        String(
          network.mock.calls.find(([url]) => url.endsWith("/record"))![1]?.body,
        ),
      ).payload,
    ).toEqual({ outcome: "performed" });
  });
  it("does not offer recording when a pinned effective receipt is unreadable", async () => {
    const row = item();
    row.occurrence.effective_receipt_id = receiptId;
    snapshot = reply([row]);
    snapshot.partial = ["receipts"];
    render(<SiteWorkPage />);
    expect(
      await screen.findByText(
        /Current receipt unavailable. Recording is unavailable/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh receipt" }),
    ).toBeVisible();
  });
  it("keeps an unresolved adopted draft from being replaced by a second draft", async () => {
    const draft = {
      id: draftId,
      command: "record_work",
      target_id: task,
      request_key: "earlier-save",
      state: "pending",
      expires_at: null,
    };
    const previous = network.getMockImplementation()!;
    network.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("drafts?state=pending"))
        return json({ drafts: [draft, { ...draft, id: "another-draft" }] });
      if (url.endsWith(`/drafts/${draftId}`))
        return json({ outcome: "unsaved", draft });
      return previous(url, init);
    });
    render(<SiteWorkPage />);
    const checks = await screen.findAllByRole("button", {
      name: "Check earlier save",
    });
    await userEvent.click(checks[0]);
    await screen.findByRole("button", { name: "Retry the same save" });
    expect(
      screen.getByRole("button", { name: "Check earlier save" }),
    ).toBeDisabled();
  });
  it.each([false, true])(
    "hydrates authoritative state after evidence finalization (replay %s) and restores row focus",
    async (replay) => {
      const rule = {
        kind: "linked_record",
        label: "Inspection record",
        min_count: 1,
        when: "always" as const,
      };
      const row = item();
      row.receipt = receipt({
        evidence_status_current: "missing",
        missing_evidence: [rule],
        completion_state: "performed_missing_evidence",
      });
      row.rules!.evidence = [rule];
      row.occurrence.status = "in_progress";
      snapshot = reply([row]);
      const previous = network.getMockImplementation()!;
      network.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/evidence"))
          return json({
            evidence: { id: "evidence-1", state: "finalized" },
            replayed: replay,
            satisfaction: replay
              ? null
              : {
                  receipt_evidence_status: "complete",
                  occurrence: {
                    id: task,
                    status: "completed",
                    execution_state: "completed",
                    effective_receipt_id: receiptId,
                  },
                },
          });
        if (url.endsWith("/receipts"))
          return json({
            receipts: [
              receipt({
                evidence_status_current: "complete",
                revision: "b".repeat(64),
              }),
            ],
            occurrence: {
              id: task,
              status: "completed",
              execution_state: "completed",
              effective_receipt_id: receiptId,
            },
          });
        return previous(url, init);
      });
      render(<SiteWorkPage />);
      const primary = await screen.findByRole("button", {
        name: "View receipt history",
      });
      await userEvent.type(
        screen.getByLabelText("Record identifier"),
        receiptId,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Attach record" }),
      );
      expect(await screen.findByText("Evidence: complete")).toBeVisible();
      expect(screen.getByText("Status: completed · completed")).toBeVisible();
      await waitFor(() => expect(primary).toHaveFocus());
      expect(
        screen.queryByLabelText("Record identifier"),
      ).not.toBeInTheDocument();
      expect(
        network.mock.calls.filter(([url]) => url.includes("/workspace?")),
      ).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: "Reverse" }));
      await userEvent.type(screen.getByLabelText("Reason"), "Wrong entry");
      await userEvent.click(
        screen.getByRole("button", { name: "Save reversal" }),
      );
      await waitFor(() =>
        expect(
          network.mock.calls.some(([url]) => url.endsWith("/reverse")),
        ).toBe(true),
      );
      expect(
        JSON.parse(
          String(
            network.mock.calls.find(([url]) => url.endsWith("/reverse"))![1]
              ?.body,
          ),
        ),
      ).toMatchObject({ expected_receipt_revision: "b".repeat(64) });
    },
  );
  it("corrects with a full typed restatement and a required reason", async () => {
    const row = item();
    row.receipt = receipt({
      values: { temperature: 21 },
      note: "Preserved note",
    });
    row.rules!.inputs = [
      {
        key: "temperature",
        label: "Temperature",
        type: "number",
        required: true,
      },
    ];
    snapshot = reply([row]);
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Correct" }),
    );
    expect(screen.getByLabelText("Temperature (required)")).toHaveValue(21);
    await userEvent.clear(screen.getByLabelText("Temperature (required)"));
    await userEvent.type(screen.getByLabelText("Temperature (required)"), "22");
    await userEvent.type(
      screen.getByLabelText("Correction reason"),
      "Correct reading",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save correction" }),
    );
    await waitFor(() =>
      expect(network.mock.calls.some(([url]) => url.endsWith("/correct"))).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        String(
          network.mock.calls.find(([url]) => url.endsWith("/correct"))![1]
            ?.body,
        ),
      ),
    ).toMatchObject({
      expected_receipt_id: receiptId,
      payload: {
        outcome: "performed",
        values: { temperature: 22 },
        reason: "Correct reading",
      },
    });
  });
  it("blocks all new mutations until earlier drafts are checked", async () => {
    const previous = network.getMockImplementation()!;
    network.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith("drafts?state=pending")
        ? new Promise<Response>(() => {})
        : previous(url, init),
    );
    render(<SiteWorkPage />);
    expect(
      await screen.findByRole("button", { name: "Complete" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Report an issue" }),
    ).toBeDisabled();
  });
  it.each(["failed", "not_performed", "late", "on_behalf"])(
    "records %s only through explicit More options with valid command schema",
    async (option) => {
      render(<SiteWorkPage />);
      await userEvent.click(
        await screen.findByRole("button", { name: "More options" }),
      );
      if (option === "failed" || option === "not_performed")
        await userEvent.selectOptions(screen.getByLabelText("Outcome"), option);
      else
        await userEvent.selectOptions(
          screen.getByLabelText("Entry type"),
          option,
        );
      await userEvent.type(
        screen.getByLabelText("Reason"),
        "Observed and recorded",
      );
      if (option === "failed")
        await userEvent.type(
          screen.getByLabelText("Issue summary"),
          "Failed inspection",
        );
      if (option === "on_behalf") {
        await userEvent.selectOptions(
          screen.getByLabelText("Performer"),
          "other_staff",
        );
        await userEvent.type(
          screen.getByLabelText("Performer identifier"),
          receiptId,
        );
      }
      await userEvent.click(screen.getByRole("button", { name: "Save work" }));
      await waitFor(() =>
        expect(
          network.mock.calls.some(([url]) => url.endsWith("/record")),
        ).toBe(true),
      );
      const body = JSON.parse(
        String(
          network.mock.calls.find(([url]) => url.endsWith("/record"))![1]?.body,
        ),
      );
      expect(body.payload).toMatchObject({
        outcome:
          option === "failed" || option === "not_performed"
            ? option
            : "performed",
        entry_reason: "Observed and recorded",
      });
    },
  );
  it("returns focus after cancel without changing URL or reloading", async () => {
    render(<SiteWorkPage />);
    const primary = await screen.findByRole("button", {
      name: "Complete",
    });
    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(primary).toHaveFocus();
    expect(env.replace).not.toHaveBeenCalled();
    expect(
      network.mock.calls.filter(([url]) => url.includes("/workspace?")),
    ).toHaveLength(1);
  });
  it("hydrates a recovered receipt and current occurrence without reloading the list", async () => {
    const draft = {
      id: draftId,
      command: "record_work",
      target_id: task,
      request_key: "earlier-save",
      state: "pending",
      expires_at: null,
    };
    const previous = network.getMockImplementation()!;
    network.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("drafts?state=pending"))
        return json({ drafts: [draft] });
      if (url.endsWith(`/drafts/${draftId}`))
        return json({
          outcome: "saved",
          draft,
          record: { id: receiptId, kind: "receipt", replayed: true },
        });
      if (url.endsWith("/receipts"))
        return json({
          receipts: [receipt()],
          occurrence: {
            id: task,
            status: "completed",
            execution_state: "completed",
          },
        });
      return previous(url, init);
    });
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Check earlier save" }),
    );
    expect(
      await screen.findByText("Status: completed · completed"),
    ).toBeVisible();
    expect(screen.getByText(/Recorded by.*already saved/)).toBeVisible();
    expect(
      network.mock.calls.filter(([url]) => url.includes("/workspace?")),
    ).toHaveLength(1);
    expect(
      network.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });
  it("preserves another person's performance identity, time and note when correcting", async () => {
    const row = item();
    row.receipt = receipt({
      recorder_id: receiptId,
      performer_kind: "self",
      performed_at: "2026-09-09T13:00:00.123456Z",
      note: "Historical note",
    });
    snapshot = reply([row]);
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Correct" }),
    );
    expect(screen.getByLabelText("Performer")).toHaveValue("other_staff");
    expect(screen.getByLabelText("Performer identifier")).toHaveValue(
      receiptId,
    );
    await userEvent.type(
      screen.getByLabelText("Correction reason"),
      "Fix measurement",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save correction" }),
    );
    await waitFor(() =>
      expect(network.mock.calls.some(([url]) => url.endsWith("/correct"))).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        String(
          network.mock.calls.find(([url]) => url.endsWith("/correct"))![1]
            ?.body,
        ),
      ).payload,
    ).toMatchObject({
      performer: { kind: "other_staff", user_id: receiptId },
      entry_kind: "on_behalf",
      performed_at: "2026-09-09T13:00:00.123456Z",
      note: "Historical note",
      reason: "Fix measurement",
    });
  });
  it("allows a fresh one-action recording after an authoritative reversal", async () => {
    const row = item();
    row.receipt = receipt();
    row.occurrence.effective_receipt_id = receiptId;
    snapshot = reply([row]);
    commandReply = {
      receipt: receipt({
        id: "reversal",
        receipt_kind: "reversal",
        outcome: null,
        completion_state: "reversed",
      }),
      occurrence: {
        id: task,
        status: "pending",
        execution_state: "none",
        effective_receipt_id: null,
      },
      replayed: false,
    };
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Reverse" }),
    );
    await userEvent.type(screen.getByLabelText("Reason"), "Wrong work");
    await userEvent.click(
      screen.getByRole("button", { name: "Save reversal" }),
    );
    const complete = await screen.findByRole("button", { name: "Complete" });
    commandReply = {
      receipt: receipt(),
      occurrence: {
        status: "completed",
        execution_state: "completed",
        effective_receipt_id: receiptId,
      },
      replayed: false,
    };
    await userEvent.click(complete);
    await waitFor(() =>
      expect(network.mock.calls.some(([url]) => url.endsWith("/record"))).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        String(
          network.mock.calls.find(([url]) => url.endsWith("/record"))![1]?.body,
        ),
      ).payload,
    ).toEqual({ outcome: "performed" });
  });
  it("clearing More options removes hidden outcomes from the one-action request", async () => {
    render(<SiteWorkPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "More options" }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Outcome"),
      "not_performed",
    );
    await userEvent.type(screen.getByLabelText("Reason"), "Hidden reason");
    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete" }));
    await screen.findByText("Receipt state: completed");
    expect(
      JSON.parse(
        String(
          network.mock.calls.find(([url]) => url.endsWith("/record"))![1]?.body,
        ),
      ).payload,
    ).toEqual({ outcome: "performed" });
  });
  it("blocks a new attachment while a correction remains unconfirmed", async () => {
    const row = item();
    const evidenceRule = {
      kind: "linked_record",
      label: "Inspection",
      min_count: 1,
      when: "on_success" as const,
    };
    row.rules!.evidence = [evidenceRule];
    row.receipt = receipt({
      evidence_status_current: "missing",
      missing_evidence: [evidenceRule],
    });
    row.occurrence.effective_receipt_id = receiptId;
    snapshot = reply([row]);
    render(<SiteWorkPage />);
    await userEvent.type(
      await screen.findByLabelText("Record identifier"),
      "88888888-8888-4888-8888-888888888888",
    );
    await userEvent.click(screen.getByRole("button", { name: "Correct" }));
    await userEvent.type(
      screen.getByLabelText("Correction reason"),
      "Check the original reading",
    );
    lost = true;
    await userEvent.click(
      screen.getByRole("button", { name: "Save correction" }),
    );
    await screen.findByText("Not saved yet");
    const attach = screen.getByRole("button", { name: "Attach record" });
    expect(attach).toBeDisabled();
    expect(screen.getByLabelText("Record identifier")).toBeDisabled();
    fireEvent.submit(attach.closest("form")!);
    expect(
      network.mock.calls.filter(
        ([url]) => url === "/api/admin/operations/evidence",
      ),
    ).toHaveLength(0);
  });

  it("re-lists pending saves after changing view before allowing new work", async () => {
    const rendered = render(<SiteWorkPage />);
    await screen.findByRole("button", { name: "Complete" });
    env.query = `facility_id=${facility}&view=upcoming`;
    snapshot = { ...reply(), view: "upcoming", groups: { upcoming: [] } };
    rendered.rerender(<SiteWorkPage />);
    await screen.findByText("Upcoming · next fourteen days");
    env.query = `facility_id=${facility}&view=today`;
    snapshot = reply();
    rendered.rerender(<SiteWorkPage />);
    await screen.findByRole("button", { name: "Complete" });
    await waitFor(() =>
      expect(
        network.mock.calls.filter(([url]) =>
          url.endsWith("drafts?state=pending"),
        ),
      ).toHaveLength(3),
    );
  });
});
