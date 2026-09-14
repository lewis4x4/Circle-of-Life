import { handleStandUpGoogle } from "./handler.ts";

Deno.serve((request) => handleStandUpGoogle(request));
