import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BehaviorLogModal, ConditionLogModal, GeneralNoteModal } from "./resident-log-modals";

const mock = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), context: vi.fn(), dailyLogId: vi.fn(), evaluate: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: mock.from, auth: { getUser: mock.getUser } }), isBrowserSupabaseConfigured: () => true }));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContext: mock.context }));
vi.mock("@/lib/caregiver/daily-log-link", () => ({ fetchShiftDailyLogId: mock.dailyLogId }));
vi.mock("@/lib/infection-control/request-evaluate-vitals", () => ({ requestEvaluateVitals: mock.evaluate }));

type Result = { data: unknown; error: Error | null };
let writes: { table: string; op: "insert" | "update"; payload: unknown }[];
let writeResult: Result;

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  writeResult = { data: null, error: null };
  mock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mock.context.mockResolvedValue({ ok: true, ctx: { facilityId: "facility-1", organizationId: "org-1", facilityName: "Synthetic", timeZone: "America/New_York" } });
  mock.dailyLogId.mockResolvedValue("daily-1");
  mock.evaluate.mockResolvedValue({ ok: true });
  mock.from.mockImplementation((table: string) => {
    let pendingWrite: Result | null = null;
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: { id: "daily-1" }, error: null }),
      insert: (payload: unknown) => { writes.push({ table, op: "insert", payload }); pendingWrite = writeResult; return chain; },
      update: (payload: unknown) => { writes.push({ table, op: "update", payload }); pendingWrite = writeResult; return chain; },
      then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(pendingWrite ?? { data: [], error: null }).then(resolve, reject),
    };
    return chain;
  });
});

const DARK_ONLY_CLASSES = /zinc-|bg-black|text-rose-|text-teal-|text-primary-\d|border-rose-|border-teal-|border-primary-\d|text-white/;

function expectEveryControlLabelled(dialog: HTMLElement) {
  const controls = dialog.querySelectorAll("input, textarea, button[role=combobox]");
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.id, `${control.tagName} has an id`).not.toBe("");
    expect(dialog.querySelector(`label[for="${control.id}"]`), `label for ${control.id}`).not.toBeNull();
  }
}

describe("resident quick-entry dialogs", () => {
  it("behavior: labelled fields, no dark-only palette, disabled-until-required, saves the resident and facility", async () => {
    render(<BehaviorLogModal open onOpenChange={vi.fn()} residentId="resident-1" residentName="Marsha Wheeler" />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /log behavior/i })).toBeInTheDocument();
    await within(dialog).findByLabelText(/what was observed/i);
    expectEveryControlLabelled(dialog);
    expect(dialog.outerHTML).not.toMatch(DARK_ONLY_CLASSES);

    const save = within(dialog).getByRole("button", { name: /save behavior entry/i });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/what was observed/i), { target: { value: "Pacing the hallway" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    expect(await within(dialog).findByRole("status")).toHaveTextContent(/behavior entry saved/i);
    const insert = writes.find((w) => w.table === "behavioral_logs" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ resident_id: "resident-1", facility_id: "facility-1", organization_id: "org-1", logged_by: "user-1", behavior: "Pacing the hallway", daily_log_id: "daily-1" });
  });

  it("condition: a failed save shows a recoverable error and keeps the form; retry succeeds", async () => {
    render(<ConditionLogModal open onOpenChange={vi.fn()} residentId="resident-1" residentName="Marsha Wheeler" />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /log condition/i })).toBeInTheDocument();
    const description = await within(dialog).findByLabelText(/description/i);
    expectEveryControlLabelled(dialog);
    expect(dialog.outerHTML).not.toMatch(DARK_ONLY_CLASSES);

    fireEvent.change(description, { target: { value: "New cough since lunch" } });
    fireEvent.click(within(dialog).getByLabelText(/nurse has been notified/i));
    writeResult = { data: null, error: new Error("network down") };
    fireEvent.click(within(dialog).getByRole("button", { name: /submit condition report/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("network down");
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue("New cough since lunch");

    writeResult = { data: null, error: null };
    fireEvent.click(within(dialog).getByRole("button", { name: /submit condition report/i }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent(/condition report submitted/i);
    const insert = writes.filter((w) => w.table === "condition_changes").at(-1);
    expect(insert?.payload).toMatchObject({ resident_id: "resident-1", facility_id: "facility-1", organization_id: "org-1", nurse_notified: true, nurse_notified_by: "user-1" });
  });

  it("general note: heading matches the entry point and note/vitals save separately", async () => {
    render(<GeneralNoteModal open onOpenChange={vi.fn()} residentId="resident-1" residentName="Marsha Wheeler" />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /^general note$/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: /shift log/i })).toBeNull();
    const note = await within(dialog).findByLabelText(/shift note/i, { selector: "textarea" });
    expectEveryControlLabelled(dialog);
    expect(dialog.outerHTML).not.toMatch(DARK_ONLY_CLASSES);

    const saveNote = within(dialog).getByRole("button", { name: /save note to daily log/i });
    const saveVitals = within(dialog).getByRole("button", { name: /save vitals/i });
    expect(saveNote).toBeDisabled();
    expect(saveVitals).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/pulse/i), { target: { value: "72" } });
    expect(saveVitals).toBeEnabled();
    expect(saveNote).toBeDisabled();

    fireEvent.change(note, { target: { value: "Ate well at lunch" } });
    fireEvent.click(saveNote);
    expect(await within(dialog).findByRole("status")).toHaveTextContent(/saved to the daily log/i);
    const insert = writes.find((w) => w.table === "daily_logs" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ resident_id: "resident-1", facility_id: "facility-1", organization_id: "org-1", logged_by: "user-1" });
    expect((insert?.payload as { general_notes: string }).general_notes).toMatch(/\] Ate well at lunch$/);
    await waitFor(() => expect(mock.evaluate).not.toHaveBeenCalled());
  });

  it("shows a themed unavailable state when the working facility cannot be resolved", async () => {
    mock.context.mockResolvedValue({ ok: false, error: "Choose your working facility in the header before continuing." });
    render(<BehaviorLogModal open onOpenChange={vi.fn()} residentId="resident-1" residentName="Marsha Wheeler" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/choose your working facility/i);
    expect(screen.getByRole("heading", { name: /entry unavailable/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog").outerHTML).not.toMatch(DARK_ONLY_CLASSES);
  });
});
