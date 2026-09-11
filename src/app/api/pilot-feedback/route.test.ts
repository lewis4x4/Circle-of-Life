import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: vi.fn(),
  revalidateCurrentApiActor: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: vi.fn(),
}));

import { GET, PATCH, POST } from "./route";
import { requireCurrentApiActor, revalidateCurrentApiActor, type CurrentApiActor } from "@/lib/auth/current-api-actor";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const FACILITY_ID = "00000000-0000-0000-0002-000000000003";

type Profile = {
  organization_id: string;
  app_role: CurrentApiActor["appRole"];
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
  query.maybeSingle = vi.fn(() => Promise.resolve({ data: (response().data as unknown[])?.[0] ?? null, error: response().error }));
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

    vi.mocked(requireCurrentApiActor).mockImplementation(async ({ allowedRoles } = {}) =>
      (!allowedRoles || allowedRoles.includes(profile.app_role))
        ? { actor: {
        id: USER_ID,
        organizationId: ORGANIZATION_ID,
        appRole: profile.app_role,
        email: profile.email,
        fullName: profile.full_name,
        sessionEmail: "session@example.com",
        client: {} as CurrentApiActor["client"],
        admin: admin as unknown as CurrentApiActor["admin"],
      } }
        : { response: Response.json({ error: "Insufficient permissions" }, { status: 403 }) } as never);
    vi.mocked(revalidateCurrentApiActor).mockImplementation(async (actor) => ({ actor }) as never);
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
      }),
    );
  });

  it("requires a current facility lookup for org-wide reviewers", async () => {
    profile.app_role = "owner";
    vi.mocked(serviceRoleUserHasFacilityAccess).mockResolvedValue(true);

    const response = await GET(new Request(`http://localhost/api/pilot-feedback?facilityId=${FACILITY_ID}&limit=25`));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.feedback).toHaveLength(1);
    expect(serviceRoleUserHasFacilityAccess).toHaveBeenCalled();
    expect(feedbackQuery.eq).toHaveBeenCalledWith("facility_id", FACILITY_ID);
  });

  it("passes reviewer roles before constructing a service-backed actor", async () => {
    profile.app_role = "family";

    const response = await GET(new Request("http://localhost/api/pilot-feedback"));

    expect(response.status).toBe(403);
    expect(requireCurrentApiActor).toHaveBeenCalledWith(expect.objectContaining({
      allowedRoles: ["owner", "org_admin", "facility_admin", "manager"],
    }));
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("returns the same not-found response for a cross-organization PATCH id", async () => {
    feedbackRows = [];

    const response = await PATCH(new Request("http://localhost/api/pilot-feedback", {
      method: "PATCH",
      body: JSON.stringify({ id: "foreign-feedback", status: "triaged" }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Feedback item not found" });
    expect(feedbackQuery.eq).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(feedbackQuery.update).not.toHaveBeenCalled();
  });
});
