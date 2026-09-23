import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const scope = vi.hoisted(() => ({ facility: "one", role: "facility_admin", user: "actor-one", pathname: "/admin/staffing" }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: (select: (s: { selectedFacilityId: string }) => unknown) => select({ selectedFacilityId: scope.facility }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: scope.role, organizationId: "org", user: { id: scope.user } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => scope.pathname }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { WorkforceContext, useWorkforce } from "./WorkforceContext";
function Readback() { const state = useWorkforce(); return <output data-testid="snapshot">{state.loading ? "Loading" : state.error ?? state.data?.facilityName ?? "No data"}</output>; }
const app = () => <WorkforceContext><Readback /></WorkforceContext>;
const response = (name: string) => ({ ok: true, json: async () => ({ facilityName: name, people: [], weekStart: "2026-09-14", weekEnd: "2026-09-20", nextWeekStart: "2026-09-28", scheduleStatus: "Draft", timeclockEnabled: true, payrollStatus: "Pending" }) });
beforeEach(() => { scope.facility = "one"; scope.role = "facility_admin"; scope.user = "actor-one"; scope.pathname = "/admin/staffing"; });
describe("Workforce source scope", () => {
  it("removes the prior actor's data immediately after a role change", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("Building One")));
    const ui = render(app());
    await waitFor(() => expect(screen.getByTestId("snapshot")).toHaveTextContent("Building One"));
    scope.role = "med_tech";
    ui.rerender(app());
    expect(screen.getByTestId("snapshot")).not.toHaveTextContent("Building One");
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });
  it("does not let an old facility response replace the current facility", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first).mockResolvedValue(response("Building Two")));
    const ui = render(app());
    scope.facility = "two";
    ui.rerender(app());
    await waitFor(() => expect(screen.getByTestId("snapshot")).toHaveTextContent("Building Two"));
    await act(async () => { resolveFirst(response("Building One")); });
    expect(screen.getByTestId("snapshot")).toHaveTextContent("Building Two");
  });
  it("refreshes source records when returning from a correction page", async () => {
    const fetcher = vi.fn().mockResolvedValue(response("Refreshed"));
    vi.stubGlobal("fetch", fetcher);
    const ui = render(app());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    scope.pathname = "/admin/timecards";
    ui.rerender(app());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
