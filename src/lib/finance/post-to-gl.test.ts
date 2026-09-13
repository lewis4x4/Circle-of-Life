import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import { postInvoiceToGl, postPaymentToGl } from "./post-to-gl";

describe("HFA-009 HFA-011 atomic source posting", () => {
  it.each([["invoice", postInvoiceToGl], ["payment", postPaymentToGl]] as const)("posts %s through one command", async (kind, post) => {
    const rpc = vi.fn().mockResolvedValue({ data: { journal_entry_id: "journal-1" }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    expect(await post(client, "source-1")).toEqual({ ok: true, journalEntryId: "journal-1" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("post_finance_source", { p_source_type: kind, p_source_id: "source-1" });
  });

  it("preserves a failed posting result instead of treating a draft as posted", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Accounting period is closed" } });
    expect(await postInvoiceToGl({ rpc } as unknown as SupabaseClient<Database>, "source-1"))
      .toEqual({ ok: false, error: "Accounting period is closed" });
  });

  it.each([null, {}, [], { journal_entry_id: 5 }])("requires a committed journal receipt (%j)", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect((await postPaymentToGl({ rpc } as unknown as SupabaseClient<Database>, "source-1")).ok).toBe(false);
  });
});
