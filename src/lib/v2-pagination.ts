export const DEFAULT_V2_PAGE_SIZE = 50;
export const MAX_V2_PAGE_SIZE = 100;
export const MAX_V2_PAGE = 1_000;

export type V2PaginationInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined;

export type V2PaginationRange = {
  page: number;
  pageSize: number;
  from: number;
  to: number;
};

export type V2PaginationMeta = V2PaginationRange & {
  totalCount: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

function coercePositiveInt(value: string | string[] | null | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function resolveV2Pagination(input?: V2PaginationInput): V2PaginationRange {
  const pageRaw =
    input instanceof URLSearchParams ? input.get("page") : (input?.page ?? null);
  const pageSizeRaw =
    input instanceof URLSearchParams ? input.get("pageSize") : (input?.pageSize ?? null);

  const pageUnclamped = coercePositiveInt(pageRaw) ?? 1;
  const page = Math.min(MAX_V2_PAGE, pageUnclamped);
  const pageSizeUnclamped = coercePositiveInt(pageSizeRaw) ?? DEFAULT_V2_PAGE_SIZE;
  const pageSize = Math.min(MAX_V2_PAGE_SIZE, pageSizeUnclamped);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return { page, pageSize, from, to };
}

export function buildV2PaginationMeta(
  range: V2PaginationRange,
  totalCount: number | null | undefined,
): V2PaginationMeta {
  const normalizedTotal = Number.isFinite(totalCount) ? Math.max(0, totalCount ?? 0) : 0;
  return {
    ...range,
    totalCount: normalizedTotal,
    hasPreviousPage: range.page > 1,
    hasNextPage: range.to + 1 < normalizedTotal,
  };
}

export function isV2PaginationOutOfRange(pagination: V2PaginationMeta): boolean {
  return pagination.totalCount > 0 && pagination.from >= pagination.totalCount;
}
