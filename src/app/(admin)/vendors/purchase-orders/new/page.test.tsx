import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "../../../admin/vendors/purchase-orders/new/page";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), push: vi.fn(), actor: "actor", org: "org", role: "owner", client: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../../vendor-hub-nav", () => ({ VendorHubNav: () => null }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ organizationId: mocks.org, appRole: mocks.role }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));

function success(_name: string, args: {p_request_id:string;p_facility_id:string;p_vendor_id:string}) {
  return Promise.resolve({ error: null, data: { request_id: args.p_request_id, purchase_order_id: "po", po_number: "PO-2026-00001",
    facility_id: args.p_facility_id, vendor_id: args.p_vendor_id, total_cents: 1000, line_count: 1 } });
}
async function submit(name = "Create draft PO") {
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name }).closest("form")!); });
}
async function ready() {
  const view = render(<Page />);
  await screen.findByRole("option", { name: "Facility A" });
  fireEvent.change(screen.getByLabelText("Facility"), { target: { value: "facility" } });
  fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "vendor" } });
  return view;
}
beforeEach(() => {
  mocks.actor = "actor"; mocks.org = "org"; mocks.role = "owner";
  mocks.rpc.mockReset(); mocks.push.mockReset();
  mocks.client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: mocks.actor } } }, error: null }) }, rpc: mocks.rpc,
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, is: () => q,
        order: async () => ({ data: [{ id: table === "facilities" ? "facility" : "vendor", name: table === "facilities" ? "Facility A" : "Vendor A" }], error: null }) };
      return q;
    },
  };
});
describe("canonical atomic purchase order creation", () => {
  it("uses one command and navigates only after a matching receipt", async () => {
    mocks.rpc.mockImplementation(success); await ready(); await submit();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe("create_purchase_order");
    expect(mocks.rpc.mock.calls[0][1].p_expected_caller).toBe("actor");
    expect(mocks.push).toHaveBeenCalledWith("/admin/vendors/purchase-orders/po");
  });
  it.each([["Quantity", "0"], ["Quantity", "-1"], ["Quantity", "1.00001"], ["Quantity", "1junk"],
    ["Quantity", "100000000"], ["Unit cost (cents)", "1.2"], ["Unit cost (cents)", "-1"], ["Unit cost (cents)", "2147483648"], ["Line description", " "]])("rejects invalid %s %s before sending", async (label, value) => {
    await ready(); fireEvent.change(screen.getByLabelText(label), { target: { value } }); await submit();
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("Nothing was created");
  });
  it("confirms fractional quantity half-cent rounding with exact decimal arithmetic", async () => {
    mocks.rpc.mockImplementation(async (name, args) => {
      const value = await success(name, args); value.data.total_cents = 501; return value;
    });
    await ready();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "0.1001" } });
    fireEvent.change(screen.getByLabelText("Unit cost (cents)"), { target: { value: "5000" } });
    await submit(); expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it("unlocks initial definite rollback and uses a new request after correction", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "Link vendor first" }, data: null });
    await ready(); await submit(); expect(screen.getByLabelText("Quantity")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } }); await submit();
    expect(mocks.rpc.mock.calls[0][1].p_request_id).not.toBe(mocks.rpc.mock.calls[1][1].p_request_id);
  });
  it("keeps identical mounted request after lost response, rerender and later denial", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce({ error: { code: "42501", message: "Revoked" }, data: null }).mockImplementationOnce(success);
    const view = await ready(); await submit();
    expect(screen.getByLabelText("Quantity")).toBeDisabled(); expect(mocks.push).not.toHaveBeenCalled();
    view.rerender(<Page />); await submit("Retry same purchase order");
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
    await submit("Retry same purchase order");
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
    expect(mocks.rpc.mock.calls[2]).toEqual(mocks.rpc.mock.calls[0]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it("blocks auth switches but allows the same caller's renewed session", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("Lost response")).mockImplementationOnce(success);
    await ready(); await submit(); mocks.actor = "other"; await submit("Retry same purchase order");
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(screen.getByLabelText("Quantity")).toBeDisabled();
    mocks.actor = "actor"; await submit("Retry same purchase order"); expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it("locks incomplete receipts and suppresses synchronous duplicate submits", async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockImplementation(() => new Promise(r => { resolve = r; }));
    await ready();
    const form = screen.getByRole("button", { name: "Create draft PO" }).closest("form")!;
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    await act(async () => resolve({ data: { purchase_order_id: "po" }, error: null }));
    expect(screen.getByLabelText("Quantity")).toBeDisabled(); expect(mocks.push).not.toHaveBeenCalled();
  });
});
