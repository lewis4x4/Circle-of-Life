import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { T8InboxThreaded } from "./T8InboxThreaded";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/family-messages",
  useSearchParams: () => new URLSearchParams(""),
}));

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

describe("<T8InboxThreaded />", () => {
  it("renders queue, thread detail, and audit footer", () => {
    render(
      <T8InboxThreaded
        title="Family messages"
        queue={[
          { id: "m1", title: "Smith family — meds question", unread: true },
          { id: "m2", title: "Jones family — visit confirm" },
        ]}
        renderThread={(item) => (item ? <p>thread: {item.title}</p> : <p>no selection</p>)}
        audit={audit}
      />,
    );

    expect(screen.getByRole("navigation", { name: /inbox queue/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /thread detail/i })).toHaveTextContent(/smith family/i);
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("switches thread on queue item click", async () => {
    const user = userEvent.setup();
    render(
      <T8InboxThreaded
        title="Inbox"
        queue={[
          { id: "m1", title: "First" },
          { id: "m2", title: "Second" },
        ]}
        renderThread={(item) => <p>active: {item?.title ?? "none"}</p>}
        audit={audit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open thread: second/i }));
    expect(screen.getByRole("region", { name: /thread detail/i })).toHaveTextContent(/active: second/i);
  });

  it("renders empty queue state", () => {
    render(
      <T8InboxThreaded
        title="Inbox"
        queue={[]}
        renderThread={() => <p>no thread</p>}
        audit={audit}
      />,
    );
    expect(screen.getByText(/queue is empty/i)).toBeInTheDocument();
  });
});
