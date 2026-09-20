import { handleBoldSignWebhook } from "./handler.ts";

if (import.meta.main) Deno.serve(handleBoldSignWebhook);
