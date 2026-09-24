import { afterEach, describe, expect, it, vi } from "vitest";

import type { RetryOwner } from "./check-submit";
import { forgetFloorRetryOwner, rememberFloorRetryOwner, rememberedFloorRetryOwner, resolveFloorRetryOwner } from "./retry-owner";

const OWNER: RetryOwner = { userId: "user-ashley", sessionId: "session-1", organizationId: "org-1", facilityId: "fac-1" };
const base = { organizationId: "org-1", facilityId: "fac-1" };

afterEach(() => forgetFloorRetryOwner());

describe("floor retry owner", () => {
  it("asks Haven while online and remembers the answer for the unlock", async () => {
    const resolve = vi.fn(async () => OWNER);
    await expect(resolveFloorRetryOwner({ ...base, unlockId: "unlock-1", resolve, online: true })).resolves.toEqual(OWNER);
    expect(rememberedFloorRetryOwner("unlock-1", "fac-1")).toEqual(OWNER);
  });

  it("offline, saves as the owner remembered at unlock without a network call", async () => {
    rememberFloorRetryOwner("unlock-1", OWNER);
    const resolve = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    await expect(resolveFloorRetryOwner({ ...base, unlockId: "unlock-1", resolve, online: false })).resolves.toEqual(OWNER);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("falls back to the remembered owner when Haven cannot be reached", async () => {
    rememberFloorRetryOwner("unlock-1", OWNER);
    const resolve = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    await expect(resolveFloorRetryOwner({ ...base, unlockId: "unlock-1", resolve, online: true })).resolves.toEqual(OWNER);
  });

  it("never lends one unlock's owner to the next unlock or another facility", async () => {
    rememberFloorRetryOwner("unlock-1", OWNER);
    expect(rememberedFloorRetryOwner("unlock-2", "fac-1")).toBeNull();
    expect(rememberedFloorRetryOwner("unlock-1", "fac-2")).toBeNull();
    const resolve = vi.fn(async () => {
      throw new Error("Your sign-in could not be confirmed.");
    });
    await expect(resolveFloorRetryOwner({ ...base, unlockId: "unlock-2", resolve, online: false })).rejects.toThrow("Your sign-in could not be confirmed.");
  });

  it("is forgotten on lock", () => {
    rememberFloorRetryOwner("unlock-1", OWNER);
    forgetFloorRetryOwner();
    expect(rememberedFloorRetryOwner("unlock-1", "fac-1")).toBeNull();
  });
});
