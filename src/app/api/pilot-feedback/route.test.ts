import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: vi.fn(),
}));

import { GET, POST } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import { createClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const FACILITY_ID = "00000000-0000-0000-0002-000000000003";

type Profile = {
  organization_id: string;
  app_role: string;
  email: string | null;
  full_name: string | null;
};

type QueryResponse = { data: unknown; error: { message: string } | null };

function createQuery(response: () => QueryResponse) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.insert = vi.fn((payload: unknown) => {
    query.insertedPayload = payload;
    return query;
  });
  query.update = vi.fn(() => query);
  query.single = vi.fn(() => Promise.resolve({ data: { id: "feedback-1", created_at: "2026-05-03T12:00:00.000Z" }, error: null }));
  query.then = (onFulfilled: (value: QueryResponse) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(response()).then(onFulfilled, onRejected);
  return query as Record<string, ReturnType<typeof vi.fn>> & {
    insertedPayload?: unknown;
    then: PromiseLike<QueryResponse>["then"];
  };
}

describe("/api/pilot-feedback", () => {
  let profile: Profile;
  let feedbackRows: unknown[];
  let profileQuery: Record<string, ReturnType<typeof vi.fn>>;
  let feedbackQuery: ReturnType<typeof createQuery>;
  let admin: { from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    profile = {
      organization_id: ORGANIZATION_ID,
      app_role: "manager",
      email: "manager@example.com",
      full_name: "Pilot Manager",
    };
    feedbackRows = [{ id: "feedback-1", metadata: { route: "/admin" } }];

    profileQuery = {
      select: vi.fn(() => profileQuery),
      eq: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(() => Promise.resolve({ data: profile, error: null })),
    };
    feedbackQuery = createQuery(() => ({ data: feedbackRows, error: null }));
    admin = {
      from: vi.fn((table: string) => {
        if (table === "user_profiles") return profileQuery;
        if (table === "pilot_feedback_submissions") return feedbackQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({
            data: { user: { id: USER_ID, email: "session@example.com" } },
            error: null,
          }),
        ),
      },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never);
    vi.mocked(serviceRoleUserHasFacilityAccess).mockResolvedValue(true);
  });

  it("requires facility access before creating facility-scoped feedback", async () => {
    vi.mocked(serviceRoleUserHasFacilityAccess).mockResolvedValue(false);

    const response = await POST(
      new Request("http://localhost/api/pilot-feedback", {
        method: "POST",
        body: JSON.stringify({
          facilityId: FACILITY_ID,
          shellKind: "admin",
          route: "/admin/residents",
          category: "bug",
          severity: "medium",
          title: "Cannot save resident",
          detail: "The save button did not respond.",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(serviceRoleUserHasFacilityAccess).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        userId: USER_ID,
        facilityId: FACILITY_ID,
        organizationId: ORGANIZATION_ID,
        appRole: "manager",
      }),
    );
    expect(feedbackQuery.insert).not.toHaveBeenCalled();
  });

  it("truncates long feedback fields before inserting", async () => {
    const response = await POST(
      new Request("http://localhost/api/pilot-feedback", {
        method: "POST",
        body: JSON.stringify({
          facilityId: FACILITY_ID,
          shellKind: "x".repeat(120),
          route: `/${"route".repeat(100)}`,
          category: "request",
          severity: "high",
          title: "T".repeat(250),
          detail: "D".repeat(4_500),
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(feedbackQuery.insert).toHaveBeenCalledTimes(1);
    const payload = feedbackQuery.insertedPayload as {
      facility_id: string;
      shell_kind: string;
      route: string;
      title: string;
      detail: string;
    };
    expect(payload.facility_id).toBe(FACILITY_ID);
    expect(payload.shell_kind).toHaveLength(80);
    expect(payload.route).toHaveLength(240);
    expect(payload.title).toHaveLength(180);
    expect(payload.detail).toHaveLength(4_000);
  });

  it("requires facility access before listing facility-scoped feedback for non-org-wide reviewers", async () => {
    vi.mocked(serviceRoleUserHasFacilityAccess).mockResolvedValue(false);

    const response = await GET(new Request(`http://localhost/api/pilot-feedback?facilityId=${FACILITY_ID}`));

    expect(response.status).toBe(404);
    expect(serviceRoleUserHasFacilityAccess).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        userId: USER_ID,
        facilityId: FACILITY_ID,
        organizationId: ORGANIZATION_ID,
        appRole: "manager",
      }),
    );
  });

  it("allows org-wide reviewers to list facility-scoped feedback without per-facility lookup", async () => {
    profile.app_role = "owner";
    vi.mocked(serviceRoleUserHasFacilityAccess).mockResolvedValue(false);

    const response = await GET(new Request(`http://localhost/api/pilot-feedback?facilityId=${FACILITY_ID}&limit=25`));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.feedback).toHaveLength(1);
    expect(serviceRoleUserHasFacilityAccess).not.toHaveBeenCalled();
    expect(feedbackQuery.eq).toHaveBeenCalledWith("facility_id", FACILITY_ID);
  });
});
