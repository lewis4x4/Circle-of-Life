import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  auth: { getSession: vi.fn(), getUser: vi.fn(), signInWithPassword: vi.fn(), resetPasswordForEmail: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: mocks.auth }), isBrowserSupabaseConfigured: () => true }));
import LoginPage from "./page";

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: { app_metadata: { app_role: "caregiver" } } }, error: null });
  mocks.auth.resetPasswordForEmail.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  cleanup();
});
function prerender() { container.innerHTML = renderToString(<LoginPage />); }
async function hydrate() { await act(async () => { root = hydrateRoot(container, <LoginPage />); }); }

describe("login credential safety before hydration", () => {
  it("server-renders POST protection so a native fallback cannot serialize credentials into a URL", () => {
    prerender();
    expect(container.querySelector("form")).toHaveAttribute("method", "post");
  });
  it("keeps all controls disabled and credential fields absent from native form data until hydration", () => {
    prerender();
    const controls = container.querySelectorAll("input, button");
    expect(controls.length).toBeGreaterThanOrEqual(5);
    controls.forEach((control) => expect(control).toBeDisabled());
    expect(within(container).getByRole("status")).toHaveTextContent("Preparing secure sign-in");
    // Even browser autofill cannot make disabled fields successful controls.
    (container.querySelector('[name="email"]') as HTMLInputElement).value = "synthetic@example.test";
    (container.querySelector('[name="password"]') as HTMLInputElement).value = "SyntheticTestOnly123!";
    const body = new FormData(container.querySelector("form")!);
    expect(body.has("email")).toBe(false);
    expect(body.has("password")).toBe(false);
    expect(mocks.auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it("enables the hydrated form and prevents native submission while normal sign-in runs", async () => {
    prerender(); await hydrate();
    const email = screen.getByLabelText("Work Email");
    const password = screen.getByLabelText("Password");
    expect(email).toBeEnabled(); expect(password).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
    expect(screen.queryByText(/Preparing secure sign-in/)).not.toBeInTheDocument();
    fireEvent.change(email, { target: { value: "synthetic@example.test" } });
    fireEvent.change(password, { target: { value: "SyntheticTestOnly123!" } });
    expect(fireEvent.submit(container.querySelector("form")!)).toBe(false);
    await waitFor(() => expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({ email: "synthetic@example.test", password: "SyntheticTestOnly123!" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/caregiver"));
  });
  it("preserves the hydrated password-reset flow without submitting credentials", async () => {
    prerender(); await hydrate();
    fireEvent.change(screen.getByLabelText("Work Email"), { target: { value: "synthetic@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    await screen.findByText("If that account exists, a password reset link has been sent.");
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith("synthetic@example.test", { redirectTo: `${window.location.origin}/reset-password` });
    expect(mocks.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
