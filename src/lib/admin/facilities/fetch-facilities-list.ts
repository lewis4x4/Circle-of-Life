import type { FacilityRow } from "@/types/facility";

export type FacilitiesListPagination = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
};

export type FacilitiesListResult = {
  facilities: FacilityRow[];
  pagination: FacilitiesListPagination;
};

export type FetchFacilitiesListParams = {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

type FacilitiesResponse = {
  facilities: Record<string, unknown>[];
  total: number;
  page: number;
  has_next: boolean;
};

function normalizeListRow(raw: Record<string, unknown>): FacilityRow {
  type ListApi = FacilityRow & {
    occupancy_count?: number;
    total_beds?: number;
    occupancy_pct?: number;
    administrator_staff_id?: string | null;
    survey_readiness_pct?: number | null;
    portfolio_open_incidents_total?: number;
    portfolio_open_incidents_level_3?: number;
    labor_cost_mtd_pct?: number | null;
    last_survey_date?: string | null;
    last_survey_result?: string | null;
    total_licensed_beds?: number;
    administrator_name?: string | null;
  };

  const f = raw as unknown as ListApi;
  const occ = typeof f.occupancy_count === "number" ? f.occupancy_count : 0;
  const licensedCapacity = typeof f.total_licensed_beds === "number" ? f.total_licensed_beds : 0;

  let occupancy_pct_norm: number | null = null;
  if (typeof f.occupancy_pct === "number" && Number.isFinite(f.occupancy_pct)) {
    occupancy_pct_norm =
      f.occupancy_pct <= 1 ? f.occupancy_pct : Math.min(1, Math.max(0, f.occupancy_pct / 100));
  }

  return {
    ...(f as unknown as FacilityRow),
    current_occupancy: occ,
    licensed_beds: licensedCapacity,
    occupancy_pct: occupancy_pct_norm,
    administrator_staff_id: f.administrator_staff_id ?? null,
    survey_readiness_pct:
      typeof f.survey_readiness_pct === "number" && Number.isFinite(f.survey_readiness_pct)
        ? f.survey_readiness_pct
        : null,
    portfolio_open_incidents_total:
      typeof f.portfolio_open_incidents_total === "number" ? f.portfolio_open_incidents_total : 0,
    portfolio_open_incidents_level_3:
      typeof f.portfolio_open_incidents_level_3 === "number" ? f.portfolio_open_incidents_level_3 : 0,
    labor_cost_mtd_pct:
      typeof f.labor_cost_mtd_pct === "number" && Number.isFinite(f.labor_cost_mtd_pct)
        ? f.labor_cost_mtd_pct
        : null,
    last_survey_date: f.last_survey_date ?? null,
    last_survey_result: f.last_survey_result ?? null,
    administrator_name: f.administrator_name ?? null,
  } as FacilityRow;
}

export const FACILITIES_LIST_QUERY_KEY = ["facilities", "list"] as const;

export function facilitiesListQueryKey({
  status,
  search,
  page = 1,
  pageSize = 20,
}: FetchFacilitiesListParams) {
  return [...FACILITIES_LIST_QUERY_KEY, page, pageSize, status ?? "", search ?? ""] as const;
}

export async function fetchFacilitiesList({
  status,
  search,
  page = 1,
  pageSize = 20,
}: FetchFacilitiesListParams): Promise<FacilitiesListResult> {
  const params = new URLSearchParams({
    page: page.toString(),
    page_size: pageSize.toString(),
  });
  if (status) params.set("status", status);
  if (search) params.set("search", search);

  const res = await fetch(`/api/admin/facilities?${params}`);
  if (!res.ok) {
    throw new Error("Failed to fetch facilities");
  }

  const json = (await res.json()) as FacilitiesResponse;
  const facilities = (json.facilities ?? []).map((row) => normalizeListRow(row));
  const total = json.total ?? 0;

  return {
    facilities,
    pagination: {
      total,
      page: json.page ?? page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
      has_next: json.has_next ?? false,
    },
  };
}
