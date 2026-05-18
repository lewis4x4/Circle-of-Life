import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockResult: { data: unknown[] | null; count: number | null; error: { message: string } | null } = {
  data: null,
  count: 0,
  error: null,
};

const selectMock = vi.fn();
const orderMock = vi.fn();
const rangeMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u-1" } }, error: null })),
    },
    schema: () => ({
      from: () => ({
        select: selectMock,
      }),
    }),
  })),
}));

import { V2_LIST_IDS, isV2ListId, loadV2List } from "./v2-lists";

describe("v2-lists narrowing + loader", () => {
  beforeEach(() => {
    selectMock.mockReset().mockImplementation(() => ({ order: orderMock }));
    orderMock
      .mockReset()
      .mockImplementationOnce(() => ({ order: orderMock }))
      .mockImplementationOnce(() => ({ range: rangeMock }));
    rangeMock.mockReset().mockResolvedValue(mockResult);
    mockResult = { data: null, count: 0, error: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the four canonical list ids", () => {
    expect(V2_LIST_IDS).toEqual(["residents", "incidents", "alerts", "admissions"]);
  });

  it("isV2ListId narrows correctly", () => {
    expect(isV2ListId("residents")).toBe(true);
    expect(isV2ListId("alerts")).toBe(true);
    expect(isV2ListId("nope")).toBe(false);
  });

  it("applies count, stable ordering, and inclusive range from pagination", async () => {
    mockResult = { data: [], count: 200, error: null };
    rangeMock.mockResolvedValue(mockResult);

    const load = await loadV2List("incidents", { page: "2", pageSize: "50" });

    expect(selectMock).toHaveBeenCalledWith(expect.any(String), { count: "exact" });
    expect(orderMock).toHaveBeenNthCalledWith(1, "occurred_at", { ascending: false });
    expect(orderMock).toHaveBeenNthCalledWith(2, "incident_id", { ascending: true });
    expect(rangeMock).toHaveBeenCalledWith(50, 99);
    expect(load.pagination).toMatchObject({ page: 2, pageSize: 50, from: 50, to: 99, totalCount: 200 });
    expect(load.source).toBe("live");
  });

  it("clamps invalid pagination and max page size", async () => {
    mockResult = { data: [], count: 0, error: null };
    rangeMock.mockResolvedValue(mockResult);

    const load = await loadV2List("residents", { page: "-3", pageSize: "999" });

    expect(rangeMock).toHaveBeenCalledWith(0, 99);
    expect(load.pagination.page).toBe(1);
    expect(load.pagination.pageSize).toBe(100);
  });

  it("returns unavailable on query error", async () => {
    mockResult = { data: null, count: null, error: { message: "boom" } };
    rangeMock.mockResolvedValue(mockResult);

    const load = await loadV2List("incidents");
    expect(load.source).toBe("unavailable");
    expect(load.rows).toEqual([]);
  });

  it("returns live when total rows exist but current page has no rows", async () => {
    mockResult = { data: [], count: 10, error: null };
    rangeMock.mockResolvedValue(mockResult);

    const load = await loadV2List("alerts", { page: "99", pageSize: "50" });
    expect(load.rows).toEqual([]);
    expect(load.source).toBe("live");
  });

  it("returns empty only when total count is zero", async () => {
    mockResult = { data: [], count: 0, error: null };
    rangeMock.mockResolvedValue(mockResult);

    const load = await loadV2List("alerts");
    expect(load.source).toBe("empty");
  });
});
