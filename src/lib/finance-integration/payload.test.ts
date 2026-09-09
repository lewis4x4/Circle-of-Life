import { describe, expect, it } from "vitest";
import { cents, decimalAmount, MAX_CENTS, sumCents, summaryPayloadSchema } from "./payload";
const valid = () => ({ schemaVersion: 1, companyReference: "123", batchReference: "1b967175-6171-4190-885e-7c67f57b9102", accountingDate: "2026-09-08", currency: "USD", lines: [{ accountReference: "100", side: "debit", amountCents: "5000000001" }, { accountReference: "200", side: "credit", amountCents: "5000000001" }] });
describe("HFA-027 HFA-036 structural privacy and exact amounts", () => {
  it("accepts balanced non-identifying structural fixture beyond 32-bit cents", () => {
    expect(summaryPayloadSchema.parse(valid()).lines[0].amountCents).toBe("5000000001");
    expect(decimalAmount("5000000001")).toBe("50000000.01");
  });
  it("retains precision beyond JSON safe integer and rejects storage overflow", () => {
    expect(decimalAmount("9007199254740993")).toBe("90071992547409.93");
    expect(sumCents(["5000000001", "4999999999"])).toBe("10000000000");
    expect(() => sumCents([MAX_CENTS.toString(), "1"])).toThrow();
    for (const value of ["1.2", "1e2", "01", "-0", "NaN", " 1"]) expect(() => cents(value)).toThrow();
    expect(decimalAmount("-1")).toBe("-0.01");
  });
  it.each(["residentId", "memo", "description", "filename", "attachments", "source", "error"])("rejects arbitrary %s at top level and nested levels", (field) => {
    expect(summaryPayloadSchema.safeParse({ ...valid(), [field]: "synthetic-private-detail" }).success).toBe(false);
    const payload = valid();
    Object.assign(payload.lines[0], { [field]: "synthetic-private-detail" });
    expect(summaryPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it("rejects invalid dates, amounts, identifiers, currency and unbalanced journals", () => {
    expect(summaryPayloadSchema.safeParse({ ...valid(), accountingDate: "2026-02-30" }).success).toBe(false);
    expect(summaryPayloadSchema.safeParse({ ...valid(), companyReference: "Resident Smith" }).success).toBe(false);
    expect(summaryPayloadSchema.safeParse({ ...valid(), currency: "EUR" }).success).toBe(false);
    const payload = valid(); payload.lines[0].amountCents = "5000000000";
    expect(summaryPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
