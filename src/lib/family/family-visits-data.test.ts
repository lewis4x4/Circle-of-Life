import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { fetchFamilyResidentVisits, familyVisitTitle, familyVisitWhen, parseFamilyVisits } from "@/lib/family/family-visits-data";

describe("family visits (COL-871)", () => {
  it("reads the RPC payload and treats anything unknown as not shared", () => {
    expect(parseFamilyVisits({ sharing: "with_visitor_name", visits: [{ id: "v1", arrived_at: "2026-09-25T23:17:42Z", left_at: null, visitor_type: "family_friend", visitor_name: "Jordan P." }] })).toEqual({
      sharing: "with_visitor_name",
      visits: [{ id: "v1", arrivedAt: "2026-09-25T23:17:42Z", leftAt: null, visitorType: "family_friend", visitorName: "Jordan P." }],
    });
    expect(parseFamilyVisits(null)).toEqual({ sharing: "off", visits: [] });
    expect(parseFamilyVisits({ sharing: "everything", visits: "x" })).toEqual({ sharing: "off", visits: [] });
  });

  it("names the visitor only when the facility shares names", () => {
    const base = { id: "v1", arrivedAt: "2026-09-25T23:17:42Z", leftAt: null, visitorType: "family_friend" };
    expect(familyVisitTitle({ ...base, visitorName: "Jordan P." })).toBe("Jordan P. (family or friend)");
    expect(familyVisitTitle({ ...base, visitorName: null })).toBe("Family or friend");
  });

  it("says when, in the facility's time", () => {
    const base = { id: "v1", visitorType: "family_friend", visitorName: null };
    expect(familyVisitWhen({ ...base, arrivedAt: "2026-09-25T23:17:42Z", leftAt: "2026-09-26T00:05:00Z" })).toBe("Sep 25, 7:17 PM – 8:05 PM");
    expect(familyVisitWhen({ ...base, arrivedAt: "2026-09-25T23:17:42Z", leftAt: null })).toBe("Sep 25, 7:17 PM · still signed in");
  });

  it("calls the family RPC and never reads the building log directly", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { sharing: "times_only", visits: [] }, error: null });
    const from = vi.fn();
    const result = await fetchFamilyResidentVisits({ rpc, from } as never, "r1");
    expect(rpc).toHaveBeenCalledWith("family_resident_visits", { p_resident_id: "r1", p_limit: 100 });
    expect(from).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, sharing: "times_only", visits: [] });
    const source = fs.readFileSync(path.join(import.meta.dirname, "family-visits-data.ts"), "utf8");
    expect(source).not.toMatch(/visitor_log_entries/);
    expect(source).not.toMatch(/loved one/i);
  });
});
