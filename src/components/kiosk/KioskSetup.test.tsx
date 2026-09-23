import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KIOSK_SETUP_COPY } from "@/lib/kiosk/screens";
import { KIOSK_COPY } from "@/lib/timeclock/kiosk-contract";
import { createMemoryKioskStore } from "@/lib/timeclock/kiosk-store";

import { KioskSetup } from "./KioskSetup";
import { json, navigation, renderInKiosk } from "./kiosk-test-utils";

vi.mock("next/navigation", async () => {
  const { navigation: nav } = await import("./kiosk-test-navigation");
  return { usePathname: () => nav.pathname, useRouter: () => nav.router };
});

beforeEach(() => {
  navigation.replace.mockReset();
});

describe("KioskSetup", () => {
  it("enrolls a kiosk-kind device, stores the token and opens the kiosk", async () => {
    const store = createMemoryKioskStore({ device: null });
    const fetchImpl = vi.fn(async () => json(200, { device_id: "d", token: "new-token", facility_id: "f1", facility_name: "Synthetic facility 0001" }));
    renderInKiosk(<KioskSetup />, { store, fetchImpl, pathname: "/kiosk/setup" });
    expect(await screen.findByRole("heading", { level: 1, name: KIOSK_SETUP_COPY.title })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(KIOSK_SETUP_COPY.codeLabel), { target: { value: "abcd2345" } });
    fireEvent.change(screen.getByLabelText(KIOSK_SETUP_COPY.nameLabel), { target: { value: "HL-KIOSK-01" } });
    fireEvent.click(screen.getByRole("button", { name: KIOSK_SETUP_COPY.submit }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/kiosk"));
    expect((await store.getDevice())?.token).toBe("new-token");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/kiosk/timeclock/enroll");
    expect(JSON.parse(String(init.body))).toEqual({ code: "ABCD2345", label: "HL-KIOSK-01" });
  });

  it("says the code did not work and clears it", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "code_invalid" }));
    renderInKiosk(<KioskSetup />, { store: createMemoryKioskStore({ device: null }), fetchImpl, pathname: "/kiosk/setup" });
    fireEvent.change(await screen.findByLabelText(KIOSK_SETUP_COPY.codeLabel), { target: { value: "ABCD2345" } });
    fireEvent.change(screen.getByLabelText(KIOSK_SETUP_COPY.nameLabel), { target: { value: "HL-KIOSK-01" } });
    fireEvent.click(screen.getByRole("button", { name: KIOSK_SETUP_COPY.submit }));
    expect((await screen.findAllByText(KIOSK_COPY.errors.code_invalid)).length).toBeGreaterThan(0);
    expect((screen.getByLabelText(KIOSK_SETUP_COPY.codeLabel) as HTMLInputElement).value).toBe("");
  });
});
