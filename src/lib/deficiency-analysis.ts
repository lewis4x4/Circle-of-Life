import { createClient } from "@/lib/supabase/client";

export type DeficiencyTrendPoint = {
  month: string; // YYYY-MM format
  tag_number: string;
  tag_title: string;
  count: number;
};

export type DeficiencyRecurrence = {
  tag_number: string;
  tag_title: string;
  occurrences: DeficiencyOccurrence[];
  total_occurrences: number;
  days_between_average: number;
};

export type DeficiencyOccurrence = {
  deficiency_id: string;
  survey_date: string;
  severity: string;
  status: string;
  corrected_at: string | null;
  verified_at: string | null;
  gap_days: number | null; // Days since previous occurrence
};

/**
 * Get deficiency trend by tag over a specified number of months.
 *
 * @param facilityId - The facility to analyze
 * @param months - Number of months to include in trend (default: 12)
 * @returns Array of trend points grouped by month and tag
 */
export async function getDeficiencyTrendByTag(
  facilityId: string,
  months: number = 12,
): Promise<DeficiencyTrendPoint[]> {
  const supabase = createClient();

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startDateStr = startDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from("survey_deficiencies")
    .select("tag_number, tag_description, survey_date")
    .eq("facility_id", facilityId)
    .gte("survey_date", startDateStr)
    .is("deleted_at", null)
    .order("survey_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch deficiency trend: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Group by month and tag
  const grouped = new Map<string, number>();

  for (const row of data) {
    const month = row.survey_date.slice(0, 7); // YYYY-MM
    const key = `${month}|${row.tag_number}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  // Convert to array format for charting
  const result: DeficiencyTrendPoint[] = [];
  for (const [key, count] of grouped) {
    const [month, tag_number] = key.split('|');
    result.push({
      month,
      tag_number,
      tag_title: data.find((d) => d.tag_number === tag_number)?.tag_description || tag_number,
      count,
    });
  }

  return result;
}

/**
 * Get deficiency counts grouped by tag (for bar chart of most cited tags).
 *
 * @param facilityId - The facility to analyze
 * @param months - Number of months to include (default: 12)
 * @returns Array of tag counts sorted by frequency
 */
export async function getDeficiencyCountsByTag(
  facilityId: string,
  months: number = 12,
): Promise<{ tag_number: string; tag_title: string; count: number }[]> {
  const supabase = createClient();

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startDateStr = startDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from("survey_deficiencies")
    .select("tag_number, tag_description")
    .eq("facility_id", facilityId)
    .gte("survey_date", startDateStr)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to fetch deficiency counts: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Count by tag
  const counts = new Map<string, { count: number; tag_title: string }>();

  for (const row of data) {
    const existing = counts.get(row.tag_number);
    counts.set(row.tag_number, {
      count: (existing?.count || 0) + 1,
      tag_title: row.tag_description,
    });
  }

  // Sort by frequency (highest first)
  const result = Array.from(counts.entries())
    .map(([tag_number, { count, tag_title }]) => ({
      tag_number,
      tag_title,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return result;
}

/**
 * Get recurrence history for a specific tag.
 *
 * @param facilityId - The facility to analyze
 * @param tagNumber - The AHCA tag number (e.g., "220")
 * @returns Recurrence information with occurrences and gap analysis
 */
export async function getTagRecurrence(
  facilityId: string,
  tagNumber: string,
): Promise<DeficiencyRecurrence | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("survey_deficiencies")
    .select("id, tag_number, tag_description, survey_date, severity, status, corrected_at, verified_at")
    .eq("facility_id", facilityId)
    .eq("tag_number", tagNumber)
    .is("deleted_at", null)
    .order("survey_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch tag recurrence: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Build occurrences with gap analysis
  const occurrences: DeficiencyOccurrence[] = [];
  let previousDate: Date | null = null;

  for (const row of data) {
    const surveyDate = new Date(row.survey_date);
    let gapDays: number | null = null;

    if (previousDate) {
      const diffTime = surveyDate.getTime() - previousDate.getTime();
      gapDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }

    occurrences.push({
      deficiency_id: row.id,
      survey_date: row.survey_date,
      severity: row.severity,
      status: row.status,
      corrected_at: row.corrected_at,
      verified_at: row.verified_at,
      gap_days: gapDays,
    });

    previousDate = surveyDate;
  }

  // Calculate average gap between occurrences
  const gaps = occurrences
    .slice(1)
    .map((o) => o.gap_days)
    .filter((g): g is number => g !== null);

  const averageGap =
    gaps.length > 0
      ? Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length)
      : null;

  return {
    tag_number: tagNumber,
    tag_title: data[0].tag_description,
    occurrences,
    total_occurrences: occurrences.length,
    days_between_average: averageGap ?? 0,
  };
}

/**
 * Get all tags that have recurred (cited more than once).
 *
 * @param facilityId - The facility to analyze
 * @param months - Number of months to analyze (default: 24)
 * @returns Array of tags with recurrence data
 */
export async function getRecurringTags(
  facilityId: string,
  months: number = 24,
): Promise<DeficiencyRecurrence[]> {
  const supabase = createClient();

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startDateStr = startDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from("survey_deficiencies")
    .select("tag_number, tag_description")
    .eq("facility_id", facilityId)
    .gte("survey_date", startDateStr)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to fetch recurring tags: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Count occurrences per tag
  const tagCounts = new Map<string, { count: number; tag_title: string }>();

  for (const row of data) {
    const existing = tagCounts.get(row.tag_number);
    tagCounts.set(row.tag_number, {
      count: (existing?.count || 0) + 1,
      tag_title: row.tag_description,
    });
  }

  // Filter to only tags that appear more than once (recurring)
  const recurring = Array.from(tagCounts.entries())
    .filter(([_, data]) => data.count > 1)
    .map(([tag_number, data]) => ({ tag_number, ...data }));

  // Get full recurrence data for each recurring tag
  const results: DeficiencyRecurrence[] = [];

  for (const { tag_number, tag_title } of recurring) {
    const recurrence = await getTagRecurrence(facilityId, tag_number);
    if (recurrence) {
      results.push(recurrence);
    }
  }

  // Sort by most frequent occurrences
  results.sort((a, b) => b.total_occurrences - a.total_occurrences);

  return results;
}

/**
 * Get summary statistics for deficiencies.
 *
 * @param facilityId - The facility to analyze
 * @param months - Number of months to include (default: 12)
 */
export async function getDeficiencySummary(
  facilityId: string,
  months: number = 12,
): Promise<{
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  averageResolutionDays: number | null;
}> {
  const supabase = createClient();

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startDateStr = startDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from("survey_deficiencies")
    .select("severity, status, corrected_at, verified_at")
    .eq("facility_id", facilityId)
    .gte("survey_date", startDateStr)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to fetch deficiency summary: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return {
      total: 0,
      bySeverity: {},
      byStatus: {},
      averageResolutionDays: null,
    };
  }

  // Count by severity
  const bySeverity: Record<string, number> = {};
  for (const row of data) {
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;
  }

  // Count by status
  const byStatus: Record<string, number> = {};
  for (const row of data) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }

  // Calculate average resolution time (corrected_at - survey_date)
  const resolutionTimes: number[] = [];

  for (const row of data) {
    if (row.corrected_at && row.survey_date) {
      const surveyDate = new Date(row.survey_date);
      const correctedDate = new Date(row.corrected_at);
      const diffDays = (correctedDate.getTime() - surveyDate.getTime()) / (1000 * 60 * 60 * 24);
      resolutionTimes.push(diffDays);
    }
  }

  const averageResolutionDays =
    resolutionTimes.length > 0
      ? Math.round(
          resolutionTimes.reduce((sum, days) => sum + days, 0) / resolutionTimes.length
        )
      : null;

  return {
    total: data.length,
    bySeverity,
    byStatus,
    averageResolutionDays,
  };
}
