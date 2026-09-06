import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ create: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: state.create }));
import { verifyWitnessCredentials } from "./witness-auth";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://local.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  state.create.mockReturnValue({ auth: { signInWithPassword: state.signIn, signOut: state.signOut } });
  state.signIn.mockResolvedValue({ data: { user: { id: "witness" }, session: { access_token: "temporary" } }, error: null });
  state.signOut.mockResolvedValue({ error: null });
  vi.clearAllMocks();
});
it("creates a fresh public-key verification client and closes only its local session", async () => {
  await verifyWitnessCredentials("witness@example.test", "secret");
  await verifyWitnessCredentials("witness@example.test", "secret");
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.create).toHaveBeenCalledWith("https://local.test", "anon-key", expect.objectContaining({ auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }) }));
  expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("does not sign out when verification returns no session", async () => {
  state.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { message: "invalid" } });
  const result = await verifyWitnessCredentials("witness@example.test", "bad");
  expect(result.error).toBeTruthy();
  expect(state.signOut).not.toHaveBeenCalled();
});
