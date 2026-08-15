import { describe, expect, it } from "vitest";

import { VENDOR_CONTRACT_NO_STATUS_COPY } from "./contracts-display-copy";
import { vendorContractUiLabel } from "./vendor-category-ui";

const EM_DASH = "—";

describe("vendorContractUiLabel", () => {
  it("names a missing contract status instead of an em dash", () => {
    expect(vendorContractUiLabel("")).toBe(VENDOR_CONTRACT_NO_STATUS_COPY);
    expect(vendorContractUiLabel("   ")).toBe(VENDOR_CONTRACT_NO_STATUS_COPY);
    expect(vendorContractUiLabel(null)).toBe(VENDOR_CONTRACT_NO_STATUS_COPY);
    expect(vendorContractUiLabel(undefined)).toBe(VENDOR_CONTRACT_NO_STATUS_COPY);
    expect(vendorContractUiLabel(0)).toBe(VENDOR_CONTRACT_NO_STATUS_COPY);
    expect(vendorContractUiLabel("")).not.toBe(EM_DASH);
  });

  it("returns posted contract status labels unchanged", () => {
    expect(vendorContractUiLabel("active")).toBe("Active");
    expect(vendorContractUiLabel("no_contract")).toBe("No contract");
    expect(vendorContractUiLabel("expired")).toBe("Expired");
    expect(vendorContractUiLabel("partnership")).toBe("Partnership");
    expect(vendorContractUiLabel("na")).toBe("N/A");
  });
});
