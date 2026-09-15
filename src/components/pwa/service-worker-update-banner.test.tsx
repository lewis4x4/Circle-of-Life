import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ServiceWorkerUpdateBanner } from "./service-worker-update-banner";

describe("ServiceWorkerUpdateBanner", () => {
  it("shows copy and invokes reload CTA", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();

    render(<ServiceWorkerUpdateBanner onReload={onReload} />);

    expect(screen.getByRole("status")).toHaveTextContent(/new version available/i);
    await user.click(screen.getByRole("button", { name: /reload to update/i }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
