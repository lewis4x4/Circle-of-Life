import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { supabaseStore } from "./store.ts";

Deno.test("regeneration requires a complete generator success rather than any 2xx", async () => {
  const original = globalThis.fetch;
  const store = supabaseStore({} as never,{url:"https://example.invalid/generator",secret:"synthetic"});
  try {
    for (const [status,ok,expected] of [[207,false,false],[200,false,false],[200,true,true]] as const) {
      globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ok}),{status}));
      assertEquals(await store.requestRegeneration("organization","facility"),expected);
    }
  } finally { globalThis.fetch = original; }
});
