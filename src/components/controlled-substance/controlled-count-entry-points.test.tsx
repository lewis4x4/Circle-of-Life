import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlledCountConsole } from "./ControlledCountConsole";
import { CountInitiationModal } from "../medication/CountInitiationModal";

const mock = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), context: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: mock.from, auth: { getUser: mock.getUser } }), isBrowserSupabaseConfigured: () => true }));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContext: mock.context }));
vi.mock("@/lib/medications/controlled-count-batch", async (importOriginal) => ({ ...await importOriginal<object>(), saveControlledCountBatch: mock.save }));

const medication = {
  id: "medication-record-42", resident_id: "resident-42", medication_name: "Morphine", strength: "10 mg", form: "tablet", route: "oral", frequency: "daily", status: "active",
  residents: { first_name: "Marian", middle_name: "E.", last_name: "Rivera", name_suffix: null, preferred_name: "Mary", beds: { rooms: { room_number: "101" } } },
};
const saved = { id: "count-1", resident_medication_id: medication.id, count_date: "2026-09-07", shift: "evening", expected_count: 8, actual_count: 7 };
type Result = { data: unknown; error: { message: string } | null };
let active: unknown[];
let pending: typeof saved[];
let identities: Result | Promise<Result>;
let queries: { table: string; filters: [string, string, unknown][]; select: string }[];

afterEach(() => { vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.clearAllMocks();
  active = [medication]; pending = []; identities = { data: [medication], error: null }; queries = [];
  mock.getUser.mockResolvedValue({ data: { user: { id: "outgoing-1" } } });
  mock.context.mockResolvedValue({ ok: true, ctx: { facilityId: "facility-1", organizationId: "org-1" } });
  mock.save.mockResolvedValue([saved]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verified: true }) }));
  mock.from.mockImplementation((table: string) => {
    const query = { table, filters: [] as [string, string, unknown][], select: "" }; queries.push(query);
    const chain = {
      select: (value: string) => { query.select = value; return chain; },
      eq: (field: string, value: unknown) => { query.filters.push(["eq", field, value]); return chain; },
      neq: (field: string, value: unknown) => { query.filters.push(["neq", field, value]); return chain; },
      is: (field: string, value: unknown) => { query.filters.push(["is", field, value]); return chain; },
      in: (field: string, value: unknown) => { query.filters.push(["in", field, value]); return chain; },
      single: () => Promise.resolve({ data: { organization_id: "org-1" }, error: null }),
      then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(table === "resident_medications" ? query.filters.some(([op]) => op === "in") ? identities : { data: active, error: null } : { data: pending, error: null }).then(resolve, reject),
    }; return chain;
  });
});

for (const entry of ["console", "modal"] as const) {
  describe(entry, () => {
    function show(facilityId = "facility-1") {
      return entry === "console"
        ? <ControlledCountConsole title="Controlled count" description="Count stock" backHref="/" backLabel="Back" />
        : <CountInitiationModal open onOpenChange={vi.fn()} facilityId={facilityId} />;
    }
    const identityQueries = () => queries.filter((query) => query.table === "resident_medications" && query.filters.some(([op]) => op === "in"));
    const sign = () => screen.getByRole("button", { name: /^sign & request co-sign$/i });
    const cosign = () => screen.getByRole("button", { name: /^verify & co-sign$/i });

    it("renders complete count identity and resolves it again on the saved independent witness receipt", async () => {
      render(show());
      expect(await screen.findByText("Resident: Marian E. Rivera (Mary)")).toBeInTheDocument();
      expect(screen.getByText("Dose: 10 mg tablet · oral · daily")).toBeInTheDocument();
      expect(screen.getByText("Medication record: medication-record-42")).toBeInTheDocument();
      expect(screen.getByText("Morphine")).toBeInTheDocument();
      fireEvent.change(screen.getByRole("textbox", { name: "Expected quantity from inventory ledger" }), { target: { value: "8" } });
      fireEvent.change(screen.getByLabelText("Actual count on hand"), { target: { value: "7" } });
      fireEvent.click(sign());
      await waitFor(() => expect(cosign()).toBeEnabled());
      const receipt = screen.getByText(/Verify these saved counts/).parentElement!;
      expect(within(receipt).getByText("Resident: Marian E. Rivera (Mary) · Morphine · Dose: 10 mg tablet · oral · daily · Medication record: medication-record-42")).toBeInTheDocument();
      expect(within(receipt).getByText(/expected 8, counted 7/)).toBeInTheDocument();
      expect(mock.save).toHaveBeenCalledTimes(1);
      expect(mock.save.mock.calls[0][1]).toEqual([expect.objectContaining({ resident_medication_id: medication.id, facility_id: "facility-1", outgoing_staff_id: "outgoing-1", expected_count: 8, actual_count: 7 })]);
      expect(identityQueries()).toHaveLength(1);
    });

    it.each([null, { ...medication.residents, first_name: " ", last_name: "", preferred_name: "Mary" }, { ...medication.residents, first_name: "Marian", last_name: " " }])("blocks count entry and signing for unusable resident identity %j", async (residents) => {
      active = [{ ...medication, residents }];
      render(show());
      expect(await screen.findByText(/missing its resident identity/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Actual count on hand")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^sign & request co-sign$/i })).not.toBeInTheDocument();
      expect(mock.save).not.toHaveBeenCalled();
    });

    it("restores an inactive medication by saved reference with complete identity and facility scope", async () => {
      active = []; pending = [saved]; identities = { data: [{ ...medication, status: "inactive" }], error: null };
      render(show());
      await waitFor(() => expect(cosign()).toBeEnabled());
      expect(screen.getByText("Resident: Marian E. Rivera (Mary) · Morphine · Dose: 10 mg tablet · oral · daily · Medication record: medication-record-42")).toBeInTheDocument();
      expect(identityQueries()[0].filters).toEqual([["eq", "facility_id", "facility-1"], ["in", "id", [medication.id]], ["is", "deleted_at", null]]);
      const activeQuery = queries.find((query) => query.table === "resident_medications" && !query.filters.some(([op]) => op === "in"))!;
      expect(activeQuery.filters).toContainEqual(["eq", "facility_id", "facility-1"]);
      expect(activeQuery.filters).toContainEqual(["eq", "status", "active"]);
      expect(activeQuery.select).not.toContain("!inner");
      fireEvent.click(cosign());
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ countIds: [saved.id], facilityId: "facility-1", email: "", password: "" });
      expect(mock.save).not.toHaveBeenCalled();
    });

    it.each(["query failure", "missing record", "missing resident", "blank resident", "partial batch"])("blocks restored co-signing for %s and retries only identity lookup", async (failure) => {
      pending = failure === "partial batch" ? [saved, { ...saved, id: "count-2", resident_medication_id: "missing-medication" }] : [saved];
      identities = failure === "query failure" ? { data: null, error: { message: "network failure" } }
        : { data: failure === "missing record" ? [] : [{ ...medication, residents: failure === "missing resident" ? null : failure === "blank resident" ? { ...medication.residents, first_name: " " } : medication.residents }], error: null };
      render(show());
      expect(await screen.findByRole("alert")).toHaveTextContent(/Saved count identity could not be resolved. Co-signing is blocked/);
      expect(cosign()).toBeDisabled();
      fireEvent.click(cosign()); expect(fetch).not.toHaveBeenCalled();
      identities = { data: [medication, { ...medication, id: "missing-medication" }], error: null };
      fireEvent.click(screen.getByRole("button", { name: "Retry identity lookup" }));
      await waitFor(() => expect(cosign()).toBeEnabled());
      expect(identityQueries()).toHaveLength(2);
      expect(identityQueries()[1].filters).toEqual(identityQueries()[0].filters);
      expect(mock.save).not.toHaveBeenCalled();
      fireEvent.click(cosign());
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).countIds).toEqual(pending.map((row) => row.id));
    });

    it("retains the persisted batch after identity lookup fails, recovering without a second save", async () => {
      render(show()); await screen.findByText("Morphine");
      fireEvent.change(screen.getByRole("textbox", { name: "Expected quantity from inventory ledger" }), { target: { value: "8" } });
      fireEvent.change(screen.getByLabelText("Actual count on hand"), { target: { value: "7" } });
      identities = { data: null, error: { message: "network failure" } };
      fireEvent.click(sign());
      expect(await screen.findByRole("alert")).toHaveTextContent("Co-signing is blocked");
      expect(cosign()).toBeDisabled(); expect(mock.save).toHaveBeenCalledTimes(1);
      identities = { data: [medication], error: null };
      fireEvent.click(screen.getByRole("button", { name: "Retry identity lookup" }));
      await waitFor(() => expect(cosign()).toBeEnabled());
      fireEvent.click(cosign());
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(mock.save).toHaveBeenCalledTimes(1);
      expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).countIds).toEqual([saved.id]);
    });

    it("retries a failed batch save using the same count IDs and entered quantities", async () => {
      mock.save.mockRejectedValueOnce(new Error("Temporary save failure"));
      render(show()); await screen.findByText("Morphine");
      fireEvent.change(screen.getByRole("textbox", { name: "Expected quantity from inventory ledger" }), { target: { value: "8" } });
      fireEvent.change(screen.getByLabelText("Actual count on hand"), { target: { value: "7" } });
      fireEvent.click(sign());
      expect(await screen.findByRole("alert")).toHaveTextContent("Temporary save failure");
      expect(sign()).toBeEnabled();
      fireEvent.click(sign());
      await waitFor(() => expect(cosign()).toBeEnabled());
      expect(mock.save).toHaveBeenCalledTimes(2);
      expect(mock.save.mock.calls[1][1]).toEqual(mock.save.mock.calls[0][1]);
    });

    it("can resume a restored pending receipt after cancellation with no active medications", async () => {
      active = []; pending = [saved];
      render(show()); await waitFor(() => expect(cosign()).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
      fireEvent.click(screen.getByRole("button", { name: "Resume saved count verification" }));
      expect(cosign()).toBeEnabled();
      expect(mock.save).not.toHaveBeenCalled();
    });

    it("allows cancelling and resuming a blocked identity lookup", async () => {
      active = []; pending = [saved]; identities = { data: null, error: { message: "Unavailable" } };
      render(show()); await screen.findByRole("alert");
      const cancel = screen.getByRole("button", { name: "Cancel", exact: true });
      expect(cancel).toBeEnabled(); fireEvent.click(cancel);
      expect(screen.queryByRole("button", { name: /^verify & co-sign$/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Resume saved count verification" }));
      expect(cosign()).toBeDisabled();
      expect(screen.getByRole("button", { name: "Retry identity lookup" })).toBeEnabled();
      expect(mock.save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });

    if (entry === "modal") it("does not authorize a new facility with a stale identity response", async () => {
      pending = [saved]; let resolve!: (value: Result) => void;
      identities = new Promise<Result>((done) => { resolve = done; });
      const view = render(show());
      await waitFor(() => expect(identityQueries()).toHaveLength(1));
      identities = { data: [], error: null };
      view.rerender(show("facility-2"));
      await screen.findByRole("alert");
      await act(async () => { resolve({ data: [medication], error: null }); });
      expect(cosign()).toBeDisabled();
      fireEvent.click(cosign()); expect(fetch).not.toHaveBeenCalled();
      expect(identityQueries()[1].filters).toContainEqual(["eq", "facility_id", "facility-2"]);
    });
  });
}
