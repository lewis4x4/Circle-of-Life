import { describe, expect, it } from "vitest";

import { readShellActor, shellActorCacheConfig, signShellActor } from "./shell-actor-cache";

const config = { secret: "s".repeat(48), ttlSeconds: 60 };
const actor = { user_id: "user-1", organization_id: "org-1", app_role: "owner", auth_claim_version: 3 };
const binding = { sub: "user-1", sessionId: "session-1", claimVersion: 3 };

describe("shellActorCacheConfig", () => {
  it("is off without a long enough secret or with a zero TTL", () => {
    expect(shellActorCacheConfig({})).toBeNull();
    expect(shellActorCacheConfig({ HAVEN_SHELL_ACTOR_CACHE_SECRET: "short" })).toBeNull();
    expect(shellActorCacheConfig({ HAVEN_SHELL_ACTOR_CACHE_SECRET: "s".repeat(48), HAVEN_SHELL_ACTOR_CACHE_TTL_SECONDS: "0" })).toBeNull();
  });

  it("defaults to 60 s and caps the TTL at 300 s", () => {
    expect(shellActorCacheConfig({ HAVEN_SHELL_ACTOR_CACHE_SECRET: "s".repeat(48) })?.ttlSeconds).toBe(60);
    expect(shellActorCacheConfig({ HAVEN_SHELL_ACTOR_CACHE_SECRET: "s".repeat(48), HAVEN_SHELL_ACTOR_CACHE_TTL_SECONDS: "9999" })?.ttlSeconds).toBe(300);
  });
});

describe("signed shell actor", () => {
  it("round-trips for the same user and session", async () => {
    const value = await signShellActor(actor, binding, config, 1000);
    expect(await readShellActor(value ?? undefined, binding, config, 1030)).toEqual(actor);
  });

  it("expires", async () => {
    const value = await signShellActor(actor, binding, config, 1000);
    expect(await readShellActor(value ?? undefined, binding, config, 1060)).toBeNull();
  });

  it("does not move to another session or user", async () => {
    const value = (await signShellActor(actor, binding, config, 1000)) ?? undefined;
    expect(await readShellActor(value, { ...binding, sessionId: "session-2" }, config, 1001)).toBeNull();
    expect(await readShellActor(value, { ...binding, sub: "user-2" }, config, 1001)).toBeNull();
  });

  it("rejects a cookie the client edited or signed with another secret", async () => {
    const value = (await signShellActor(actor, binding, config, 1000))!;
    const [body, signature] = value.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), app_role: "org_admin" }),
    ).toString("base64url");
    expect(await readShellActor(`${forgedBody}.${signature}`, binding, config, 1001)).toBeNull();
    const other = (await signShellActor(actor, binding, { ...config, secret: "t".repeat(48) }, 1000))!;
    expect(await readShellActor(other, binding, config, 1001)).toBeNull();
    expect(await readShellActor("garbage", binding, config, 1001)).toBeNull();
  });

  it("never caches a pending password change or a session without an id", async () => {
    expect(await signShellActor({ ...actor, must_change_password: true }, binding, config)).toBeNull();
    expect(await signShellActor(actor, { ...binding, sessionId: "" }, config)).toBeNull();
    expect(await signShellActor(actor, { ...binding, sub: "user-2" }, config)).toBeNull();
  });

  it("misses once the token carries a newer claim version (role or organization change)", async () => {
    const value = (await signShellActor(actor, binding, config, 1000)) ?? undefined;
    expect(await readShellActor(value, { ...binding, claimVersion: 4 }, config, 1001)).toBeNull();
    expect(await readShellActor(value, { ...binding, claimVersion: null }, config, 1001)).toBeNull();
    expect(await signShellActor(actor, { ...binding, claimVersion: 2 }, config)).toBeNull();
  });

  it("honours a lowered TTL for cookies already issued", async () => {
    const value = (await signShellActor(actor, binding, { ...config, ttlSeconds: 300 }, 1000)) ?? undefined;
    expect(await readShellActor(value, binding, { ...config, ttlSeconds: 30 }, 1001)).toBeNull();
  });
});
