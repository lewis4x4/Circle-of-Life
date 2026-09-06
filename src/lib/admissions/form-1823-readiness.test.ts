import { expect, it } from "vitest";
import { isForm1823Current } from "./form-1823-readiness";
const record = { status: "received", physician_name: "Physician", exam_date: "2026-08-01", expiration_date: "2027-08-01" };
const evidence = { received_at: "2026-08-02", notes: "Physical signed report verified in resident file" };
it("requires current validity and evidence before admission readiness", () => {
 expect(isForm1823Current(record, evidence, "2026-09-06")).toBe(true);
 expect(isForm1823Current({ ...record, expiration_date: "2026-09-05" }, evidence, "2026-09-06")).toBe(false);
 expect(isForm1823Current(record, { ...evidence, notes: "" }, "2026-09-06")).toBe(false);
 expect(isForm1823Current({ ...record, exam_date: "2026-09-07" }, evidence, "2026-09-06")).toBe(false);
});
