import { describe, expect, it, vi } from "vitest";
import { saveControlledCountBatch } from "./controlled-count-batch";
const row = { id: "count", resident_medication_id: "med", facility_id: "facility", organization_id: "org", count_date: "2026-09-06", shift: "day" as const, expected_count: 12, actual_count: 11, outgoing_staff_id: "author" };
function client(inserted: unknown, existing: unknown) {
 const select = vi.fn().mockResolvedValue(inserted);
 const replay = { in: vi.fn().mockReturnThis(), is: vi.fn().mockResolvedValue(existing) };
 const from = vi.fn().mockReturnValueOnce({ insert: vi.fn().mockReturnValue({ select }) }).mockReturnValueOnce({ select: vi.fn().mockReturnValue(replay) });
 return { from } as never;
}
describe("controlled count batch receipts", () => {
 it("returns the exact persisted receipt after an uncertain successful attempt", async () => {
  const sb=client({error:{code:"23505",message:"duplicate"}}, {data:[row],error:null});
  await expect(saveControlledCountBatch(sb,[row])).resolves.toEqual([row]);
 });
 it("does not bless a changed actual quantity as an already saved retry", async () => {
  const sb=client({error:{code:"23505",message:"duplicate"}}, {data:[{...row,actual_count:10}],error:null});
  await expect(saveControlledCountBatch(sb,[row])).rejects.toThrow("different values");
 });
 it("surfaces real insertion failures without attempting a new batch", async () => {
  const sb=client({error:{code:"42501",message:"Authorization denied"}}, {data:[],error:null});
  await expect(saveControlledCountBatch(sb,[row])).rejects.toThrow("Authorization denied");
 });
});
