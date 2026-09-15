import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bindMock = vi.hoisted(() => vi.fn<() => () => void>(() => () => undefined));
const activateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pwa/service-worker-update", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pwa/service-worker-update")>();
  return {
    ...actual,
    bindServiceWorkerUpdateListeners: bindMock,
    activateServiceWorkerUpdate: activateMock,
  };
});

import { ServiceWorkerRegister } from "./service-worker-register";

describe("ServiceWorkerRegister", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    bindMock.mockClear();
    activateMock.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn().mockResolvedValue({} as ServiceWorkerRegistration),
      },
    });
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalNodeEnv);
    vi.unstubAllGlobals();
  });

  it("registers the service worker in production", async () => {
    render(<ServiceWorkerRegister />);
    await waitFor(() => {
      expect(navigator.serviceWorker.register).toHaveBeenCalledWith(
        "/sw.js",
        expect.objectContaining({ scope: "/", updateViaCache: "none" }),
      );
    });
  });

  it("shows the reload banner when listeners report needRefresh", async () => {
    bindMock.mockImplementation((_reg, onNeedRefresh) => {
      onNeedRefresh();
      return () => undefined;
    });

    render(<ServiceWorkerRegister />);

    expect(await screen.findByRole("button", { name: /reload to update/i })).toBeInTheDocument();
  });

  it("activates the waiting worker when reload is clicked", async () => {
    const user = userEvent.setup();
    bindMock.mockImplementation((_reg, onNeedRefresh) => {
      onNeedRefresh();
      return () => undefined;
    });

    render(<ServiceWorkerRegister />);
    await user.click(await screen.findByRole("button", { name: /reload to update/i }));
    expect(activateMock).toHaveBeenCalledOnce();
  });
});
