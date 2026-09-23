import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT ${href}`); }));
vi.mock("next/navigation", () => ({ redirect }));

import LegacyEmergencyContactsPrintRedirect from "./page";

describe("legacy emergency contacts print address", () => {
  it("sends the old in-shell address to the shell-free print sheet (COL-662)", async () => {
    const facilityId = "11111111-1111-4111-8111-111111111111";
    await expect(
      LegacyEmergencyContactsPrintRedirect({ params: Promise.resolve({ facilityId }) }),
    ).rejects.toThrow(`NEXT_REDIRECT /print/facilities/${facilityId}/emergency-contacts`);
  });
});
