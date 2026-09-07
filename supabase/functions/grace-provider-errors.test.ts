import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { CurrentActorAuthorization } from "./_shared/current-actor.ts";
import { boldSignProviderFailureResponse } from "./boldsign-send-contract/index.ts";
import { handleGraceTranscribe } from "./grace-transcribe/index.ts";
import { handleGraceTts } from "./grace-tts/index.ts";

const AUTHORIZATION: CurrentActorAuthorization = {
  actor: {
    userId: "00000000-0000-0000-0000-000000000101",
    sessionId: "00000000-0000-0000-0000-000000000102",
    email: "actor@example.test",
    organizationId: "00000000-0000-0000-0000-000000000201",
    role: "caregiver",
    claimVersion: 1,
    accessibleFacilityIds: [],
  },
  accessToken: "valid",
  revalidate: async () => {},
};

async function assertSanitizedProviderFailure(response: Response) {
  assertEquals(response.status, 502);
  const body = await response.json();
  assertEquals(Object.keys(body), ["error"]);
  if (JSON.stringify(body).includes("secret provider detail")) {
    throw new Error("provider detail leaked");
  }
}

Deno.test("Grace transcription rejected fetch returns sanitized provider failure", async () => {
  const form = new FormData();
  form.set("audio", new File([new Uint8Array([1, 2, 3])], "voice.webm"));
  const response = await handleGraceTranscribe(
    new Request("https://example.test/grace-transcribe", {
      method: "POST",
      body: form,
    }),
    {
      authorizeActor: async () => AUTHORIZATION,
      fetcher: async () => {
        throw new Error("secret provider detail");
      },
    },
  );
  await assertSanitizedProviderFailure(response);
});

Deno.test("Grace TTS rejected fetch returns sanitized provider failure", async () => {
  const response = await handleGraceTts(
    new Request("https://example.test/grace-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    }),
    {
      authorizeActor: async () => AUTHORIZATION,
      fetcher: async () => {
        throw new Error("secret provider detail");
      },
    },
  );
  await assertSanitizedProviderFailure(response);
});

Deno.test("BoldSign rejected fetch returns sanitized provider failure", async () => {
  let response: Response | null = null;
  try {
    await Promise.reject(new Error("secret provider detail"));
  } catch (error) {
    response = boldSignProviderFailureResponse(error, null);
  }
  if (!response) throw new Error("provider rejection was not handled");
  await assertSanitizedProviderFailure(response);
});
