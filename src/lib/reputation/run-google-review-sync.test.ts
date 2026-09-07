import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  resolve: vi.fn(),
  list: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/reputation/google-oauth", () => ({ refreshAccessToken: mocks.refresh }));
vi.mock("@/lib/reputation/google-business-reviews", () => ({
  GOOGLE_IMPORTED_REPLY_PLACEHOLDER: "placeholder",
  extractGoogleReviewId: (review: { id?: string }) => review.id ?? null,
  listAllReviewsForLocation: mocks.list,
  resolveGoogleLocationParent: mocks.resolve,
  reviewExcerptForRow: () => "safe excerpt",
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { runGoogleReviewSync } from "./run-google-review-sync";

function query(result: { data: unknown; error: unknown }) {
  const value: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in"]) value[method] = vi.fn(() => value);
  value.insert = vi.fn(async () => result);
  value.maybeSingle = vi.fn(async () => result);
  value.then = (resolve: (input: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return value;
}

function clients(options?: {
  credentialError?: unknown;
  accountError?: unknown;
  existingError?: unknown;
  insertError?: unknown;
}) {
  const credentialQuery = query({ data: { refresh_token: "refresh-token" }, error: options?.credentialError ?? null });
  const accountsQuery = query({
    data: [{
      id: "account-1",
      facility_id: "facility-1",
      label: "Listing",
      external_place_id: "place-1",
      organization_id: "org-1",
    }],
    error: options?.accountError ?? null,
  });
  const existingQuery = query({ data: [], error: options?.existingError ?? null });
  const insertQuery = query({ data: null, error: options?.insertError ?? null });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "reputation_accounts") return accountsQuery;
      if (table === "reputation_replies") {
        return supabase.from.mock.calls.filter(([name]) => name === "reputation_replies").length === 1
          ? existingQuery
          : insertQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  const admin = { from: vi.fn(() => credentialQuery) };
  return { supabase, admin };
}

async function run(options?: Parameters<typeof clients>[0], authorize?: (facilityId?: string) => Promise<boolean>) {
  const { supabase, admin } = clients(options);
  return runGoogleReviewSync({
    organizationId: "org-1",
    actorUserId: "actor-1",
    supabase: supabase as never,
    admin: admin as never,
    authorize,
  });
}

describe("runGoogleReviewSync safe failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refresh.mockResolvedValue({ access_token: "access-token" });
    mocks.resolve.mockResolvedValue("accounts/a/locations/b");
    mocks.list.mockResolvedValue([{ id: "review-1" }]);
  });

  it("does not expose a token provider failure", async () => {
    const sentinel = "private OAuth client secret in provider response";
    mocks.refresh.mockRejectedValue(new Error(sentinel));

    const result = await run();

    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result).toEqual({
      status: "token_refresh",
      message: "Google authorization could not be refreshed. Reconnect Google and retry.",
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      "reputation.sync.google",
      expect.any(Error),
      { action: "refresh_token" },
    );
  });

  it("categorizes credential database failures without exposing detail", async () => {
    const sentinel = "private OAuth credential table detail leaked";

    const result = await run({ credentialError: { message: sentinel } });

    expect(result).toEqual({ status: "no_credentials", reason: "load_failed" });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(mocks.logError).toHaveBeenCalledWith(
      "reputation.sync.google",
      expect.objectContaining({ message: sentinel }),
      { action: "load_credentials" },
    );
  });

  it("does not expose an account database failure", async () => {
    const sentinel = "relation private.reputation_accounts leaked";

    const result = await run({ accountError: { message: sentinel } });

    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result).toEqual({
      status: "account_load",
      message: "Google Business listings could not be loaded. Retry the import.",
    });
  });

  it("sanitizes per-account provider detail errors", async () => {
    const sentinel = "private Google account hierarchy leaked";
    mocks.resolve.mockRejectedValue(new Error(sentinel));

    const result = await run();

    expect(result.status).toBe("success");
    expect(JSON.stringify(result)).not.toContain(sentinel);
    if (result.status === "success") {
      expect(result.details[0]?.error).toBe("Could not load Google reviews for this listing.");
    }
  });

  it("sanitizes per-account insert errors", async () => {
    const sentinel = "constraint private_reputation_reply_token leaked";

    const result = await run({ insertError: { message: sentinel } });

    expect(result.status).toBe("success");
    expect(JSON.stringify(result)).not.toContain(sentinel);
    if (result.status === "success") {
      expect(result.details[0]?.error).toBe("Could not save imported reviews for this listing.");
    }
  });

  it("does not call Google after current authorization is lost", async () => {
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await run(undefined, authorize);

    expect(result).toMatchObject({ status: "account_load", authorizationLost: true });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
