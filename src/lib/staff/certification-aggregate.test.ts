import { describe, expect, it } from "vitest";

import { CERT_STATUS_LABEL, aggregateCertStatus } from "./certification-aggregate";

const NOW = new Date("2026-09-23T12:00:00");

describe("aggregateCertStatus", () => {
  it("does not call zero certifications 'Certs OK' (COL-649)", () => {
    expect(aggregateCertStatus([], NOW)).toBe("none_on_file");
    expect(CERT_STATUS_LABEL.none_on_file).toBe("No certs on file");
  });

  it("is current when every certification is valid well past the window", () => {
    expect(aggregateCertStatus([{ status: "active", expiration_date: "2027-09-01" }], NOW)).toBe("current");
  });

  it("flags expiring and expired certifications", () => {
    expect(aggregateCertStatus([{ status: "active", expiration_date: "2026-10-15" }], NOW)).toBe("expiring_soon");
    expect(aggregateCertStatus([{ status: "active", expiration_date: "2026-09-01" }], NOW)).toBe("expired");
    expect(aggregateCertStatus([{ status: "revoked", expiration_date: null }], NOW)).toBe("expired");
    expect(aggregateCertStatus([{ status: "pending_renewal", expiration_date: null }], NOW)).toBe("expiring_soon");
  });
});
