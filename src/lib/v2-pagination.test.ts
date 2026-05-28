import { describe, expect, it } from "vitest";

import {
  DEFAULT_V2_PAGE_SIZE,
  MAX_V2_PAGE,
  MAX_V2_PAGE_SIZE,
  buildV2PaginationMeta,
  isV2PaginationOutOfRange,
  resolveV2Pagination,
} from "./v2-pagination";

describe("v2 pagination helpers", () => {
  it("uses a bounded first-page default", () => {
    expect(resolveV2Pagination()).toEqual({
      page: 1,
      pageSize: DEFAULT_V2_PAGE_SIZE,
      from: 0,
      to: DEFAULT_V2_PAGE_SIZE - 1,
    });
  });

  it("computes inclusive Supabase ranges", () => {
    expect(resolveV2Pagination({ page: "3", pageSize: "25" })).toEqual({
      page: 3,
      pageSize: 25,
      from: 50,
      to: 74,
    });
  });

  it("rejects garbage and clamps oversized page sizes", () => {
    expect(resolveV2Pagination({ page: "2abc", pageSize: "999" })).toEqual({
      page: 1,
      pageSize: MAX_V2_PAGE_SIZE,
      from: 0,
      to: MAX_V2_PAGE_SIZE - 1,
    });
  });

  it("caps extreme page offsets before building Supabase ranges", () => {
    expect(resolveV2Pagination({ page: "999999999999", pageSize: "100" })).toEqual({
      page: MAX_V2_PAGE,
      pageSize: 100,
      from: (MAX_V2_PAGE - 1) * 100,
      to: (MAX_V2_PAGE * 100) - 1,
    });
  });

  it("builds previous/next metadata from total count", () => {
    expect(buildV2PaginationMeta(resolveV2Pagination({ page: "2", pageSize: "50" }), 125)).toMatchObject({
      page: 2,
      pageSize: 50,
      totalCount: 125,
      hasPreviousPage: true,
      hasNextPage: true,
    });
  });

  it("detects out-of-range pages with rows elsewhere", () => {
    const pagination = buildV2PaginationMeta(
      resolveV2Pagination({ page: "99", pageSize: "50" }),
      10,
    );

    expect(isV2PaginationOutOfRange(pagination)).toBe(true);
  });
});
