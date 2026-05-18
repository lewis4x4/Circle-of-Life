import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppRuntimeProviders } from "./AppRuntimeProviders";

const tooltipProviderMock = vi.fn(
  ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-provider">{children}</div>,
);
const serviceWorkerRegisterMock = vi.fn(() => <div data-testid="sw-register" />);
const toasterMock = vi.fn(() => <div data-testid="toaster" />);

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: (props: { children: React.ReactNode; delay?: number; closeDelay?: number }) =>
    tooltipProviderMock(props),
}));

vi.mock("@/components/pwa/service-worker-register", () => ({
  ServiceWorkerRegister: () => serviceWorkerRegisterMock(),
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: (props: { richColors?: boolean; closeButton?: boolean; position?: string }) =>
    toasterMock(props),
}));

describe("AppRuntimeProviders", () => {
  it("renders children and runtime providers with expected props", () => {
    render(
      <AppRuntimeProviders>
        <div>Child content</div>
      </AppRuntimeProviders>,
    );

    expect(screen.getByText("Child content")).toBeInTheDocument();
    expect(screen.getByTestId("sw-register")).toBeInTheDocument();

    expect(tooltipProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ delay: 250, closeDelay: 100 }),
    );

    expect(toasterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        richColors: true,
        closeButton: true,
        position: "bottom-right",
      }),
    );
  });
});
