import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FinanceReviewQueueClient from "./FinanceReviewQueueClient";
import CanonicalPage from "@/app/(admin)/finance/integration/page";
import AdminAliasPage from "@/app/(admin)/admin/finance/integration/page";
const mocks = vi.hoisted(() => ({ auth: { user: { id: "00000000-0000-0000-0000-000000000001" }, organizationId: "00000000-0000-0000-0000-000000000010", appRole: "owner", session: { access_token: "synthetic-session-a" }, loading: false }, facility: "00000000-0000-0000-0000-000000000003" as string | null, rpc: vi.fn(), choices: vi.fn() }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => mocks.auth }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: (select: (state: {
        selectedFacilityId: string | null;
    }) => unknown) => select({ selectedFacilityId: mocks.facility }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/app/(admin)/finance/finance-hub-nav", () => ({ FinanceHubNav: () => <nav aria-label="Finance sections">Finance</nav> }));
vi.mock("@/lib/finance-integration/review-queue", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/finance-integration/review-queue")>(), loadReviewChoices: mocks.choices }));
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64);
const time = "2026-09-08T12:00:00.123456+00:00";
const batchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type Args = {
    p_entity: string;
    p_facility: string | null;
    p_kind: string;
    p_after_id: string | null;
};
const event = (n: number, facility: string | null = id(3)) => ({ id: id(n), created_at: time, facility_id: facility, operation: "payment_received", source_type: "payment", source_id: id(1000 + n), source_version: hash, amount_basis: "payment_gross", control_total_cents: "9007199254740993", claimed: false, claimed_batch_id: null as string | null });
function page(args: Args, items: unknown[] = [], more = false, total = items.length.toString()) { return { organization_id: mocks.auth.organizationId, entity_id: args.p_entity, facility_id: args.p_facility, kind: args.p_kind, observed_at: time, consistency: "live_page", items, total_count: total, returned_count: items.length, has_more: more, next_cursor: more ? { id: (items.at(-1) as {
            id: string;
        }).id, created_at: time } : null, coverage_scope: "finance_command_receipts_336_only", unrepresented_eligible_receipts: "0", staging_stopped: false, business_release_eligible: false, dispatch_enabled: false }; }
const controls = [{ amountBasis: "payment_gross", operation: "payment_received", eventCount: "1", grossCents: "100" }];
const lines = [{ accountReference: "100", side: "debit", amountCents: "100" }, { accountReference: "200", side: "credit", amountCents: "100" }];
const batchRow = () => ({ id: batchId, created_at: time, facility_id: id(3), accounting_date: "2026-09-08", status: "locally_approved_dispatch_disabled", invalid_reason: null, source_controls: controls, binding_sha256: hash, accounting_classification: "unverified", business_release_eligible: false, dispatch_enabled: false });
const detail = () => ({ batch: { ...batchRow(), organization_id: id(10), entity_id: id(2), currency: "USD", rules_version_id: id(8), payload: { schemaVersion: 1, companyReference: "123", batchReference: batchId, accountingDate: "2026-09-08", currency: "USD", lines }, payload_sha256: hash, member_set_sha256: hash, source_controls_sha256: hash, supersedes: null, preparer_session_id: "sensitive-session-never-display" }, members: [{ eventId: id(50), identitySha256: hash, sourceVersion: hash, amountBasis: "payment_gross", operation: "payment_received", controlTotalCents: "100", economicDate: "2026-09-08", lines }], decision_history: [{ id: id(60), created_at: time, batch_id: batchId, action: "approve", origin: "operator", binding_sha256: hash, resulting_status: "locally_approved_dispatch_disabled", reason_code: null, actor_session_id: "sensitive-session-never-display" }], invalid_reason: null, accounting_classification: "unverified", business_release_eligible: false, dispatch_enabled: false, binding_claim: "declared_local_only" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const signals: AbortSignal[] = [];
function transport(handler: (name: string, args: Args) => unknown | Promise<unknown>) { mocks.rpc.mockImplementation((name: string, args: Args) => ({ abortSignal: (signal: AbortSignal) => { signals.push(signal); return Promise.resolve(handler(name, args)); } })); }
beforeEach(() => {
    mocks.auth = { user: { id: id(1) }, organizationId: id(10), appRole: "owner", session: { access_token: "synthetic-session-a" }, loading: false };
    mocks.facility = id(3);
    signals.length = 0;
    mocks.rpc.mockReset();
    mocks.choices.mockReset();
    mocks.choices.mockImplementation(async (_client: unknown, organization: string) => ({ entities: [{ id: id(2), name: "Synthetic entity", organization_id: organization }], facilities: [{ id: id(3), name: "Synthetic facility A", entity_id: id(2), organization_id: organization }, { id: id(4), name: "Synthetic facility B", entity_id: id(2), organization_id: organization }] }));
    transport((_name, args) => ({ data: page(args), error: null }));
});
afterEach(cleanup);
describe("Accounting review rendered read-only journeys", () => {
    it.each([CanonicalPage, AdminAliasPage])("HFA-063: renders the operational viewer through each route entry", async Page => {
        render(<Page />);
        expect(await screen.findByText("No source events in this scope at this observation.")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Accounting review" })).toBeInTheDocument();
    });

    it("HFA-054: shows explicit empty state, live coverage limits and release blockers without mutation controls", async () => {
        render(<FinanceReviewQueueClient />);
        expect(await screen.findByText("No source events in this scope at this observation.")).toBeInTheDocument();
        expect(screen.getByText("External posting and business release are disabled")).toBeInTheDocument();
        expect(screen.getByText(/Earlier history and other sources are outside this count/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^(approve|prepare|release|post)/i })).not.toBeInTheDocument();
    });
    it("HFA-036 HFA-065: renders exact large money and a protected broader claim without a forbidden link", async () => {
        transport((_name, args) => ({ data: page(args, [{ ...event(50), claimed: true }]), error: null }));
        render(<FinanceReviewQueueClient />);
        expect(await screen.findByText("$90,071,992,547,409.93")).toBeInTheDocument();
        expect(screen.getByText("Claimed · batch details outside your scope")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "View claimed batch" })).not.toBeInTheDocument();
    });
    it("HFA-052: uses keyset next and previous page requests for more than one page", async () => {
        transport((_name, args) => ({ data: args.p_after_id ? page(args, [event(100)], false, "26") : page(args, Array.from({ length: 25 }, (_, i) => event(125 - i)), true, "26"), error: null }));
        render(<FinanceReviewQueueClient />);
        await screen.findByText(id(125));
        fireEvent.click(screen.getByRole("button", { name: "Next page" }));
        await screen.findByText(id(100));
        expect(screen.queryByText(id(125))).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
        expect(mocks.rpc).toHaveBeenLastCalledWith("finance_review_queue", expect.objectContaining({ p_after_id: id(101), p_after_created_at: time }));
        fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
        await screen.findByText(id(125));
        expect(mocks.rpc).toHaveBeenLastCalledWith("finance_review_queue", expect.objectContaining({ p_after_id: null }));
    });
    it("HFA-054: distinguishes failure from empty and retries a literal release flag violation", async () => {
        let broken = true;
        transport((_name, args) => ({ data: { ...page(args), dispatch_enabled: broken }, error: null }));
        render(<FinanceReviewQueueClient />);
        await screen.findByRole("alert");
        expect(screen.queryByText(/No source events/)).not.toBeInTheDocument();
        broken = false;
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await screen.findByText("No source events in this scope at this observation.");
    });
    it("HFA-065: ignores delayed data after facility changes and aborts its request", async () => {
        const pending = deferred<unknown>();
        let oldArgs: Args;
        transport((_name, args) => { if (args.p_facility === id(3)) {
            oldArgs = args;
            return pending.promise;
        } return { data: page(args, [event(80, id(4))]), error: null }; });
        render(<FinanceReviewQueueClient />);
        await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
        const oldSignal = signals[0];
        fireEvent.change(screen.getByRole("combobox", { name: "Facility" }), { target: { value: id(4) } });
        await screen.findByText(id(80));
        expect(oldSignal.aborted).toBe(true);
        await act(async () => pending.resolve({ data: page(oldArgs!, [event(70)]), error: null }));
        expect(screen.queryByText(id(70))).not.toBeInTheDocument();
    });
    it("HFA-065: removes prior actor data immediately and ignores a pending detail on account switch", async () => {
        const pending = deferred<unknown>();
        transport((name, args) => name === "finance_batch_snapshot" ? pending.promise : { data: page(args, [{ ...event(50), claimed: true, claimed_batch_id: batchId }]), error: null });
        const rendered = render(<FinanceReviewQueueClient />);
        fireEvent.click(await screen.findByRole("button", { name: "View claimed batch" }));
        const detailSignal = signals.at(-1)!;
        mocks.auth = { ...mocks.auth, user: { id: id(99) }, organizationId: id(11), session: { access_token: "synthetic-session-b" } };
        transport((_name, args) => ({ data: page(args), error: null }));
        rendered.rerender(<FinanceReviewQueueClient />);
        expect(screen.queryByText(id(50))).not.toBeInTheDocument();
        expect(screen.queryByText("Local batch detail")).not.toBeInTheDocument();
        await screen.findByText("No source events in this scope at this observation.");
        expect(detailSignal.aborted).toBe(true);
        await act(async () => pending.resolve({ data: detail(), error: null }));
        expect(screen.queryByText("Exact proposed journal")).not.toBeInTheDocument();
    });
    it("HFA-054 HFA-065: shows current declared rules and authorized exact detail while stripping sessions", async () => {
        transport((name, args) => name === "finance_batch_snapshot" ? { data: detail(), error: null } : { data: page(args, args.p_kind === "batches" ? [batchRow()] : args.p_kind === "rules" ? [{ id: id(8), created_at: time, mapping: { companyReference: "123", accountReferences: ["100", "200"], accountingBasis: "accrual", effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" }, content_sha256: hash, policy_reference_sha256: hash, status: "declared_draft", is_current: true, current_generation: "1" }] : []), error: null });
        render(<FinanceReviewQueueClient />);
        await screen.findByText(/No source events/);
        fireEvent.click(screen.getByRole("tab", { name: "Declared rules" }));
        await screen.findByText("Current declared draft");
        expect(screen.getByText("Provider identity and accounts are unverified.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("tab", { name: "Local batches" }));
        fireEvent.click(await screen.findByRole("button", { name: "View batch" }));
        await screen.findByText("Exact proposed journal");
        expect(screen.getByText("Historical decisions")).toBeInTheDocument();
        expect(document.body.textContent).not.toContain("sensitive-session-never-display");
        expect(within(screen.getByRole("region", { name: "Local batch detail" })).queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    });
    it("HFA-065: keeps protected detail denial distinct from an empty batch", async () => {
        transport((name, args) => name === "finance_batch_snapshot" ? { data: null, error: { code: "42501", message: "secret server details" } } : { data: page(args, [{ ...event(50), claimed: true, claimed_batch_id: batchId }]), error: null });
        render(<FinanceReviewQueueClient />);
        fireEvent.click(await screen.findByRole("button", { name: "View claimed batch" }));
        expect(await screen.findByText(/Batch detail unavailable/)).toBeInTheDocument();
        expect(document.body.textContent).not.toContain("secret server details");
        expect(screen.queryByText("Exact proposed journal")).not.toBeInTheDocument();
    });
    it("HFA-063: supports keyboard navigation through the existing tabs primitive", async () => {
        render(<FinanceReviewQueueClient />); await screen.findByText(/No source events/);
        const tab = screen.getByRole("tab", { name: "Source events" });
        act(() => tab.focus()); fireEvent.keyDown(tab, { key: "ArrowRight" });
        await waitFor(() => expect(screen.getByRole("tab", { name: "Local batches" })).toHaveFocus());
    });
    it("HFA-054: ignores a pending source page after switching record kinds", async () => {
        const pending = deferred<unknown>(); let argsBefore: Args;
        transport((_name, args) => { if (args.p_kind === "events") { argsBefore = args; return pending.promise; } return { data: page(args), error: null }; });
        render(<FinanceReviewQueueClient />);
        await waitFor(() => expect(signals.length).toBe(1));
        const prior = signals[0];
        fireEvent.click(screen.getByRole("tab", { name: "Declared rules" }));
        await screen.findByText("No declared rules in this scope at this observation.");
        await act(async () => pending.resolve({ data: page(argsBefore!, [event(70)]), error: null }));
        expect(prior.aborted).toBe(true); expect(screen.queryByText(id(70))).not.toBeInTheDocument();
    });
    it("HFA-065: clears current rows during a same-account session refresh", async () => {
        transport((_name, args) => ({ data: page(args, [event(50)]), error: null }));
        const rendered = render(<FinanceReviewQueueClient />); await screen.findByText(id(50));
        const options = deferred<unknown>(); mocks.choices.mockReturnValueOnce(options.promise);
        mocks.auth = { ...mocks.auth, session: { access_token: "new-session-same-account" } };
        rendered.rerender(<FinanceReviewQueueClient />);
        expect(screen.queryByText(id(50))).not.toBeInTheDocument();
        expect(screen.getByText("Loading authorized scopes…")).toBeInTheDocument();
        rendered.unmount(); await act(async () => options.resolve({ entities: [], facilities: [] }));
    });
    it("HFA-065: masks prior owner choices immediately on a same-session role downgrade", async () => {
        const rendered = render(<FinanceReviewQueueClient />); await screen.findByText(/No source events/);
        expect(screen.getByRole("option", { name: "All authorized facilities in entity" })).toBeInTheDocument();
        const options = deferred<unknown>(); mocks.choices.mockReturnValueOnce(options.promise);
        mocks.auth = { ...mocks.auth, appRole: "facility_admin" };
        rendered.rerender(<FinanceReviewQueueClient />);
        expect(screen.queryByRole("combobox", { name: "Entity" })).not.toBeInTheDocument();
        expect(screen.queryByText("Synthetic facility A")).not.toBeInTheDocument();
        expect(screen.getByText("Loading authorized scopes…")).toBeInTheDocument();
        rendered.unmount(); await act(async () => options.resolve({ entities: [], facilities: [] }));
    });
    it("HFA-065: restricts a facility administrator selector to an explicit facility", async () => {
        mocks.auth = { ...mocks.auth, appRole: "facility_admin" }; mocks.facility = null;
        render(<FinanceReviewQueueClient />); await screen.findByText(/No source events/);
        expect(screen.queryByRole("option", { name: "All authorized facilities in entity" })).not.toBeInTheDocument();
        expect(mocks.rpc).toHaveBeenLastCalledWith("finance_review_queue", expect.objectContaining({ p_facility: id(3) }));
    });
    it("HFA-065: aborts in-flight work on unmount", async () => {
        const pending = deferred<unknown>();
        transport(() => pending.promise);
        const rendered = render(<FinanceReviewQueueClient />);
        await waitFor(() => expect(signals.length).toBe(1));
        rendered.unmount();
        expect(signals[0].aborted).toBe(true);
        await act(async () => pending.resolve({ data: null, error: null }));
    });
});
