import { METRICS, derivedValues, easternStamp, metricDisplay, reportState, type StandUpReport, type StandUpValues } from './model'

/**
 * Three facts about a report that are easy to confuse and must never be merged:
 * its current Haven status, whether Haven holds evidence of a submission, and
 * who last saved it and when. Each is derived here so the form, the review step
 * and any later surface say the same thing.
 */

/** Current Haven status, plus the action it still needs from a person. */
export function reportStatus(report: StandUpReport | undefined, dirty = false): { state: string; qualifier: string | null } {
  const state = dirty && (report?.last_submitted_at || report?.status === 'ready') ? 'Changes awaiting resubmission' : reportState(report)
  const populated = report ? derivedValues(report.values).completed_fields > 0 || dirty : dirty
  return { state, qualifier: state !== 'Submitted' && populated ? 'Administrator review required' : null }
}

/**
 * Submission evidence only. A populated report whose origin Haven cannot
 * attribute to a Haven entry — a historical import, or a connector revision,
 * which carries no entry origin — has no original submission time to show. Say
 * that plainly instead of implying nobody submitted it.
 */
export function submissionEvidence(report?: StandUpReport): string {
  if (!report) return 'Not submitted in Haven.'
  if (report.last_submitted_at) return `Last submitted ${easternStamp(report.last_submitted_at)}.`
  if (derivedValues(report.values).completed_fields === 0) return 'Not submitted in Haven.'
  return !report.entry_origin || report.entry_origin === 'imported' ? 'Original submission time unavailable.' : 'Not submitted in Haven.'
}

/**
 * Attribution for the last save. The actor name is whatever Haven recorded —
 * a person or a connector — and is never dressed up as an identified document
 * or an administrator's review.
 */
export function lastSaveLine(report: StandUpReport | undefined, viewerId: string): string {
  if (!report) return 'No saved report yet.'
  const actor = report.updated_by && report.updated_by === viewerId ? 'you' : report.updated_by_name
  return actor ? `Last saved by ${actor} on ${easternStamp(report.updated_at)}.` : `Last saved ${easternStamp(report.updated_at)}.`
}

/** Recorded observation time for the current-snapshot sections, when there is one. */
export const snapshotAsOf = (report?: StandUpReport): string | null => report?.source_as_of ?? null

/** Figures that differ from the previous report, for the review step. */
export function changesFromPrevious(values: StandUpValues, previous: StandUpReport | undefined): string[] {
  if (!previous) return []
  return METRICS.filter(metric => values[metric.key] !== previous.values[metric.key])
    .map(metric => `${metric.label}: ${metricDisplay(metric.key, previous.values[metric.key])} to ${metricDisplay(metric.key, values[metric.key])}`)
}
