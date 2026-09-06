import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const { edge } = vi.hoisted(() => ({ edge: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: { id: "operator" } }) }));
vi.mock("@/hooks/useExecRoleKpis", () => ({ useExecRoleKpis: () => ({ kpis: null }) }));
vi.mock("@/lib/supabase/edge-auth", () => ({ authorizedEdgeFetch: edge }));
import { HavenInsightProvider, useHavenInsight } from "./HavenInsightContext";
function Harness() {
  const state = useHavenInsight();
  return <><button disabled={state.loading} onClick={() => void state.sendQuestion("Follow up")}>Ask</button><output data-testid="messages">{JSON.stringify(state.messages)}</output></>;
}
describe("Insight conversation continuity", () => {
  it("sends the returned session on follow-up and preserves evidence", async () => {
    edge.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, session_id: "session", answer: "Answer", citations: [{ label: "Report", href: "/admin/reports" }], fallback_used: true }) });
    render(<HavenInsightProvider><Harness /></HavenInsightProvider>);
    fireEvent.click(screen.getByText("Ask"));
    await waitFor(() => expect(screen.getByTestId("messages").textContent).toContain('"citations"'));
    fireEvent.click(screen.getByText("Ask"));
    await waitFor(() => expect(edge).toHaveBeenCalledTimes(2));
    expect(JSON.parse(edge.mock.calls[1][1].body).session_id).toBe("session");
    await waitFor(() => {
      const messages = JSON.parse(screen.getByTestId("messages").textContent ?? "[]");
      expect(messages).toHaveLength(4);
      expect(messages[1].fallbackUsed).toBe(true);
      expect(messages[1].citations[0].label).toBe("Report");
      expect(messages[1].id).not.toBe(messages[3].id);
    });
  });
});
