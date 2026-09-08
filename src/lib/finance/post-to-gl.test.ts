import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { postInvoiceToGl, postPaymentToGl } from "./post-to-gl";

describe("atomic source GL posting", () => {
  it("does not interpret an existing draft header as a posted receipt", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "draft" } }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue(query), rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "Draft journal draft requires review" } }) };
    expect(await postInvoiceToGl(client as unknown as SupabaseClient<Database>, "source")).toEqual({ ok: false, error: "Draft journal draft requires review" });
  });
  it.each([postInvoiceToGl, postPaymentToGl])("accepts only a complete posted receipt", async (post) => {
    for (const data of [null, {}, { journal_entry_id: "id" }, { journal_entry_id: "", already_posted: true }, { journal_entry_id: "id", already_posted: "true" }]) {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      expect((await post({ rpc } as unknown as SupabaseClient<Database>, "source")).ok).toBe(false);
    }
  });
  it.each([[postInvoiceToGl, "invoice"], [postPaymentToGl, "payment"]] as const)("uses only source identity and preserves retry status", async (post, sourceType) => {
    for (const alreadyPosted of [false, true]) {
      const rpc = vi.fn().mockResolvedValue({ data: { journal_entry_id: "journal", already_posted: alreadyPosted }, error: null });
      expect(await post({ rpc } as unknown as SupabaseClient<Database>, "source")).toEqual({ ok: true, journalEntryId: "journal", alreadyPosted });
      expect(rpc).toHaveBeenCalledExactlyOnceWith("post_source_to_gl", { p_source_type: sourceType, p_source_id: "source" });
    }
  });
  it("returns transport failures without claiming success", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("Connection lost"));
    expect(await postPaymentToGl({ rpc } as unknown as SupabaseClient<Database>, "source")).toEqual({ ok: false, error: "Connection lost" });
  });
});
