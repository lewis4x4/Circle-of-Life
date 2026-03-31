/**
 * Copy for admin list pages when `filteredRows.length === 0`.
 * If the live dataset is empty, we should not imply the user over-filtered.
 */
export function adminListFilteredEmptyCopy(params: {
  datasetRowCount: number;
  whenDatasetEmpty: { title: string; description: string };
  whenFiltersExcludeAll: { title: string; description: string };
}): { title: string; description: string } {
  return params.datasetRowCount === 0
    ? params.whenDatasetEmpty
    : params.whenFiltersExcludeAll;
}
