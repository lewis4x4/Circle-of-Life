import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-api-actor", () => ({ requireCurrentApiActor: vi.fn() }));
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { employeeFileActor } from "./employee-file-server";
import { GET, POST } from "@/app/api/admin/staff/[id]/employee-file/route";
import { GET as download } from "@/app/api/admin/staff/[id]/employee-file/download/route";
import { GET as reviewerRoster, POST as requirementCommand } from "@/app/api/admin/staff/[id]/employee-file/requirements/route";

import { GET as trainingEvidence } from "@/app/api/admin/staff/[id]/employee-file/training/route";
import { GET as sourceCatalog } from "@/app/api/admin/staff/[id]/employee-file/catalog/route";

const STAFF = "10000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000002";
const FACILITY = "10000000-0000-4000-8000-000000000003";
const ORGANIZATION = "10000000-0000-4000-8000-000000000004";
const context = () => ({ params: Promise.resolve({ id: STAFF }) });
const request = (body: unknown) => new Request("http://localhost/employee-file", { method: "POST", body: JSON.stringify(body) });
type QueryResult = { data: unknown; error: { code?: string; message: string } | null };
function query(result: () => QueryResult) {
  const q = {
    select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), order: vi.fn(() => q),
    maybeSingle: vi.fn(async () => result()),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
}

const tables = ["employee_file_requirements", "employee_file_records", "employee_file_signatures", "employee_duty_events", "staff_attendance_events", "staff_discipline_records", "employee_medical_access"];
let results: Record<string, QueryResult>;
let queries: Record<string, ReturnType<typeof query>>;
let client: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn>; storage: { from: ReturnType<typeof vi.fn> } };
let admin: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
let sign: ReturnType<typeof vi.fn>;
let role: string;
let commandRpc: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  role = "manager";
  results = Object.fromEntries(tables.map((table) => [table, { data: [], error: null }]));
  for (const table of ["user_profiles", "staff_training_completions", "staff_certifications", "competency_demonstrations"]) results[table] = { data: [], error: null };
  results.staff = { data: { id: STAFF, user_id: USER, organization_id: ORGANIZATION, facility_id: FACILITY, first_name: "Test", last_name: "Employee", employment_status: "active" }, error: null };
  queries = Object.fromEntries(Object.keys(results).map((table) => [table, query(() => results[table])]));
  sign = vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.example/short-lived" }, error: null });
  commandRpc = vi.fn().mockResolvedValue({ data: { id: "saved" }, error: null });
  client = { from: vi.fn((table: string) => {
    if (!queries[table]) throw new Error(`Unexpected table ${table}`);
    return queries[table];
  }), rpc: vi.fn((name: string, payload: unknown) => name === "haven_employee_file_staff" ? queries.staff : commandRpc(name, payload)), storage: { from: vi.fn(() => ({ createSignedUrl: sign })) } };
  admin = { from: vi.fn(() => { throw new Error("Service role must not read employee files"); }), rpc: vi.fn(() => { throw new Error("Service role must not mutate employee files"); }) };
  vi.mocked(requireCurrentApiActor).mockImplementation(async () => ({ actor: { id: USER, organizationId: ORGANIZATION, appRole: role, client, admin } }) as never);
});

describe("employee file caller authorization", () => {
  it("rejects invalid employee IDs before querying", async () => {
    const result = await employeeFileActor("../another-employee");
    expect("response" in result && result.response.status).toBe(400);
    expect(requireCurrentApiActor).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
  it("preserves current-actor authentication rejection", async () => {
    vi.mocked(requireCurrentApiActor).mockResolvedValue({ response: Response.json({ error: "Sign in" }, { status: 401 }) } as never);
    expect((await GET(new Request("http://localhost/employee-file"), context())).status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });
  it.each(["owner", "org_admin", "facility_admin", "manager"])("allows %s only after caller-visible employee lookup", async (appRole) => {
    role = appRole;
    const result = await employeeFileActor(STAFF);
    expect("canManage" in result && result.canManage).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("haven_employee_file_staff", { p_staff_id: STAFF });
    expect(client.from).not.toHaveBeenCalledWith("staff");
    expect(admin.from).not.toHaveBeenCalled();
  });
  it("allows a non-manager's own employee file", async () => {
    role = "caregiver";
    const result = await employeeFileActor(STAFF);
    expect("canManage" in result && result.canManage).toBe(false);
    expect("staff" in result && result.staff.id).toBe(STAFF);
  });
  it("does not expose another employee to a non-manager", async () => {
    role = "caregiver";
    results.staff.data = { ...(results.staff.data as object), user_id: "someone-else" };
    const response = await GET(new Request("http://localhost/employee-file"), context());
    expect(response.status).toBe(404);
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("haven_employee_file_staff", { p_staff_id: STAFF });
    expect(queries.employee_medical_access.eq).toHaveBeenCalledWith("user_id", USER);
    expect(queries.employee_medical_access.eq).toHaveBeenCalledWith("facility_id", FACILITY);
    expect(queries.employee_medical_access.eq).toHaveBeenCalledWith("organization_id", ORGANIZATION);
    expect(queries.employee_medical_access.is).toHaveBeenCalledWith("revoked_at", null);
  });
  it("does not bypass RLS when a manager cannot see the employee", async () => {
    results.staff.data = null;
    const result = await employeeFileActor(STAFF);
    expect("response" in result && result.response.status).toBe(404);
    expect(admin.from).not.toHaveBeenCalled();
  });
  it("fails closed on employee lookup errors", async () => {
    for (const table of ["user_profiles", "staff_training_completions", "staff_certifications", "competency_demonstrations"]) results[table] = { data: [], error: null };
  results.staff = { data: null, error: { message: "private database failure" } };
    const response = await POST(request({ action: "submit_record", payload: {} }), context());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database failure");
    expect(commandRpc).not.toHaveBeenCalled();
  });
});

describe("employee file read and commands", () => {
  it.each(tables)("returns no partial file when %s fails", async (table) => {
    results[table].error = { message: "sensitive internal detail" };
    const response = await GET(new Request("http://localhost/employee-file"), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The employee file could not be loaded. Retry or contact your administrator." });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("scopes file records to staff and requirements to facility", async () => {
    const response = await GET(new Request("http://localhost/employee-file"), context());
    expect(response.status).toBe(200);
    expect(queries.employee_file_records.eq).toHaveBeenCalledWith("staff_id", STAFF);
    expect(queries.employee_file_requirements.eq).toHaveBeenCalledWith("facility_id", FACILITY);
    expect(queries.employee_file_signatures.eq).toHaveBeenCalledWith("employee_file_records.staff_id", STAFF);
    expect(await response.json()).toMatchObject({ canManage: true, canMedical: true, actorId: USER, actorRole: "manager" });
  });
  it("does not claim managers have medical access just from their role", async () => {
    results.staff.data = { ...(results.staff.data as object), user_id: "other-employee" };
    const response = await GET(new Request("http://localhost/employee-file"), context());
    expect(await response.json()).toMatchObject({ canManage: true, canMedical: false });
  });
  it.each([{}, { action: "terminate_employee", payload: {} }, { action: "submit_record", payload: [] }, { action: "submit_record" }])("rejects invalid action envelope %j", async (body) => {
    expect((await POST(request(body), context())).status).toBe(400);
    expect(commandRpc).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await POST(new Request("http://localhost/employee-file", { method: "POST", body: "{" }), context())).status).toBe(400);
    expect(commandRpc).not.toHaveBeenCalled();
  });
  it("sends commands through the caller RPC, keeping database authorization authoritative", async () => {
    role = "caregiver";
    const payload = { record_id: "record-1", signer_role: "employee" };
    expect((await POST(request({ action: "sign_record", payload }), context())).status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("haven_employee_file_command", { p_staff_id: STAFF, p_action: "sign_record", p_payload: payload });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["23505", 409], ["22023", 400], ["23514", 400], ["P0001", 400], ["XX000", 503]])("maps RPC error %s to %i", async (code, status) => {
    commandRpc.mockResolvedValue({ data: null, error: { code, message: "rejected command" } });
    expect((await POST(request({ action: "review_record", payload: {} }), context())).status).toBe(status);
  });
});

describe("requirement management", () => {
  it.each(["owner", "org_admin", "facility_admin", "manager"])("serves the source catalog to scoped %s without caching", async (appRole) => {
    role = appRole;
    const response = await sourceCatalog(new Request("http://localhost/catalog"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const catalog = await response.json();
    expect(catalog).toHaveLength(95);
    expect(catalog[0]).toMatchObject({ code: "ORI-01", source_file: "SECTION 4-5.pdf" });
    expect(client.rpc).toHaveBeenCalledWith("haven_employee_file_staff", { p_staff_id: STAFF });
    expect(admin.from).not.toHaveBeenCalled();
  });
  it.each(["caregiver", "nurse", "coordinator"])("denies source catalog to %s even with employee-file access", async (appRole) => {
    role = appRole;
    const response = await sourceCatalog(new Request("http://localhost/catalog"), context());
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("0");
  });
  it("denies the catalog when a manager cannot resolve the employee", async () => {
    results.staff.data = null;
    expect((await sourceCatalog(new Request("http://localhost/catalog"), context())).status).toBe(404);
  });
  it("denies self-service users before any requirement mutation", async () => {
    role = "caregiver";
    expect((await requirementCommand(request({ action: "approve", payload: {} }), context())).status).toBe(403);
    expect(commandRpc).not.toHaveBeenCalled();
  });
  it("uses employee facility and caller RPC for manager mutations", async () => {
    const payload = { title: "Approved source" };
    expect((await requirementCommand(request({ action: "create", payload }), context())).status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("haven_employee_requirement_command", { p_facility_id: FACILITY, p_action: "create", p_payload: payload });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("rejects unsupported requirement actions", async () => {
    expect((await requirementCommand(request({ action: "delete_all", payload: {} }), context())).status).toBe(400);
    expect(commandRpc).not.toHaveBeenCalled();
  });
});

describe("restricted document download", () => {
  it("does not accept an arbitrary path in place of a record", async () => {
    expect((await download(new Request("http://localhost/download?path=other/private.pdf"), context())).status).toBe(400);
    expect(sign).not.toHaveBeenCalled();
  });
  it.each(["medical", "policy"])("signs a caller-visible %s record from the category bucket for 60 seconds", async (category) => {
    results.employee_file_records.data = { storage_path: "trusted/record.pdf", employee_file_requirements: { category } };
    const response = await download(new Request("http://localhost/download?record_id=record-1&path=attacker/file.pdf"), context());
    expect(response.status).toBe(200);
    expect(queries.employee_file_records.eq).toHaveBeenCalledWith("id", "record-1");
    expect(queries.employee_file_records.eq).toHaveBeenCalledWith("staff_id", STAFF);
    expect(client.storage.from).toHaveBeenCalledWith(category === "medical" ? "employee-medical" : "employee-personnel");
    expect(sign).toHaveBeenCalledWith("trusted/record.pdf", 60, { download: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([null, { storage_path: null }, { storage_path: "hidden.pdf" }])("fails closed when record is unavailable or query fails", async (data) => {
    results.employee_file_records = { data, error: data && "storage_path" in data && data.storage_path ? { message: "denied" } : null };
    expect((await download(new Request("http://localhost/download?record_id=hidden"), context())).status).toBe(404);
    expect(sign).not.toHaveBeenCalled();
  });
  it("returns no URL when caller storage authorization rejects signing", async () => {
    results.employee_file_records.data = { storage_path: "restricted.pdf", employee_file_requirements: { category: "medical" } };
    sign.mockResolvedValue({ data: null, error: { message: "denied" } });
    const response = await download(new Request("http://localhost/download?record_id=record-1"), context());
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("url");
  });
});


describe("reviewer roster and scoped training evidence", () => {
  it.each(["owner", "org_admin"])("allows %s to load active same-organization reviewer choices", async (appRole) => {
    role = appRole;
    results.user_profiles.data = [{ id: USER, full_name: "Named Reviewer", app_role: "nurse" }];
    results.employee_medical_access.data = [{ id: "grant-1", user_id: USER }];
    const response = await reviewerRoster(new Request("http://localhost/requirements"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ profiles: [{ full_name: "Named Reviewer" }], grants: [{ id: "grant-1" }] });
    expect(queries.user_profiles.eq).toHaveBeenCalledWith("organization_id", ORGANIZATION);
    expect(queries.user_profiles.eq).toHaveBeenCalledWith("is_active", true);
    expect(queries.user_profiles.is).toHaveBeenCalledWith("deleted_at", null);
    expect(queries.employee_medical_access.eq).toHaveBeenCalledWith("facility_id", FACILITY);
    expect(queries.employee_medical_access.is).toHaveBeenCalledWith("revoked_at", null);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(admin.from).not.toHaveBeenCalled();
  });
  it.each(["manager", "facility_admin", "nurse", "coordinator", "caregiver"])("denies reviewer roster to %s before querying profiles", async (appRole) => {
    role = appRole;
    expect((await reviewerRoster(new Request("http://localhost/requirements"), context())).status).toBe(403);
    expect(queries.user_profiles.select).not.toHaveBeenCalled();
    expect(queries.employee_medical_access.select).not.toHaveBeenCalled();
  });
  it.each(["user_profiles", "employee_medical_access"])("does not return partial reviewer roster when %s fails", async (table) => {
    role = "owner";
    results[table].error = { message: "private roster database error" };
    const response = await reviewerRoster(new Request("http://localhost/requirements"), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Reviewer access could not be loaded." });
  });
  it.each(["nurse", "coordinator"])("allows scoped %s countersign access without elevating management", async (appRole) => {
    role = appRole;
    results.staff.data = { ...(results.staff.data as object), user_id: "other-employee" };
    const response = await GET(new Request("http://localhost/employee-file"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canManage: false, canMedical: false, actorRole: appRole });
    expect(client.rpc).toHaveBeenCalledWith("haven_employee_file_staff", { p_staff_id: STAFF });
    expect(client.from).not.toHaveBeenCalledWith("staff");
    expect(admin.from).not.toHaveBeenCalled();
  });
  it("loads existing evidence using caller-scoped staff filters", async () => {
    results.staff_training_completions.data = [{ id: "training-1" }];
    results.staff_certifications.data = [{ id: "certificate-1" }];
    results.competency_demonstrations.data = [{ id: "demo-1" }];
    const response = await trainingEvidence(new Request("http://localhost/training"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ completions: [{ id: "training-1" }], certificates: [{ id: "certificate-1" }], demonstrations: [{ id: "demo-1" }] });
    for (const table of ["staff_training_completions", "staff_certifications", "competency_demonstrations"]) {
      expect(queries[table].eq).toHaveBeenCalledWith("staff_id", STAFF);
      expect(queries[table].is).toHaveBeenCalledWith("deleted_at", null);
    }
    expect(admin.from).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["staff_training_completions", "staff_certifications", "competency_demonstrations"])("fails closed when existing %s evidence lookup fails", async (table) => {
    results[table].error = { message: "sensitive training failure" };
    const response = await trainingEvidence(new Request("http://localhost/training"), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Existing training evidence could not be loaded." });
  });
  it("denies another employee's existing training to caregiver", async () => {
    role = "caregiver";
    results.staff.data = { ...(results.staff.data as object), user_id: "other-employee" };
    expect((await trainingEvidence(new Request("http://localhost/training"), context())).status).toBe(404);
    expect(queries.staff_training_completions.select).not.toHaveBeenCalled();
  });
  it.each([reviewerRoster, trainingEvidence, sourceCatalog])("preserves authentication rejection on new read endpoints", async (handler) => {
    vi.mocked(requireCurrentApiActor).mockResolvedValue({ response: Response.json({ error: "Sign in" }, { status: 401 }) } as never);
    expect((await handler(new Request("http://localhost/evidence"), context())).status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });
});


describe("explicit confidential reviewer access", () => {
  beforeEach(() => {
    role = "caregiver";
    results.staff.data = { ...(results.staff.data as object), user_id: "other-employee" };
  });
  it("permits a live scoped grant without making the reviewer a manager", async () => {
    results.employee_medical_access.data = [{ id: "live-grant" }];
    const result = await employeeFileActor(STAFF);
    expect("canManage" in result && result.canManage).toBe(false);
    expect("staff" in result && result.staff.id).toBe(STAFF);
    expect(queries.employee_medical_access.eq).toHaveBeenCalledWith("user_id", USER);
    expect(queries.employee_medical_access.eq).toHaveBeenCalledWith("facility_id", FACILITY);
    expect(queries.employee_medical_access.eq).toHaveBeenCalledWith("organization_id", ORGANIZATION);
    expect(queries.employee_medical_access.is).toHaveBeenCalledWith("revoked_at", null);
    expect(admin.from).not.toHaveBeenCalled();
  });
  it("denies access when RLS/live-grant filtering returns no grant", async () => {
    results.employee_medical_access.data = [];
    const response = await GET(new Request("http://localhost/employee-file"), context());
    expect(response.status).toBe(404);
    expect(queries.employee_medical_access.is).toHaveBeenCalledWith("revoked_at", null);
    expect(queries.employee_file_records.select).not.toHaveBeenCalled();
  });
  it("fails closed on grant lookup error even if stale data accompanies it", async () => {
    results.employee_medical_access = { data: [{ id: "stale-grant" }], error: { message: "private grant failure" } };
    const response = await POST(request({ action: "submit_record", payload: {} }), context());
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("private grant failure");
    expect(commandRpc).not.toHaveBeenCalled();
  });
});
