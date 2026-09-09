import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { answerInsuranceRenewalSummary } from "./index.ts";

Deno.test("facility insurance summary cannot query privileged organization records", async () => {
  let queried = false;
  const result = await answerInsuranceRenewalSummary({
    userRole: "facility_admin",
    admin: { from: () => { queried = true; throw new Error("Unexpected privileged query"); } },
  } as never, {} as never);
  assertEquals(queried, false);
  assertEquals(result.provenance.rows_examined, 0);
  assertEquals(result.provenance.fallback_reason, "access_restricted");
  assertEquals(result.sources, []);
});
