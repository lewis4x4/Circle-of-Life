import { METRICS, derivedValues, easternStamp, metricDisplay, reportState, type StandUpReport, type StandUpValues } from './model'

/**
 * Three facts about a report that are easy to confuse and must never be merged:
 * its current Haven status, whether Haven holds evidence of a submission, and
 * who last saved it and when. Each is derived here so the form, the review step
 * and any later surface say the same thing.
 */

/**
 * Current Haven status, plus the action it still needs from a person. Unsaved
 * entries already make a report a draft, so the line never says "Not started"
 * over figures the administrator is typing. A state that itself says "awaiting
 * review" does not repeat the qualifier.
 */
export function reportStatus(report: StandUpReport | undefined, dirty = false): { state: string; qualifier: string | null } {
  const saved = reportState(report)
  const state = dirty && (report?.last_submitted_at || report?.status === 'ready') ? 'Changes awaiting resubmission' : dirty && saved === 'Not started' ? 'Draft' : saved
  const populated = report ? derivedValues(report.values).completed_fields > 0 || dirty : dirty
  const reviewNeeded = populated && state !== 'Submitted' && state !== 'Imported, awaiting review'
  return { state, qualifier: reviewNeeded ? 'Administrator review required' : null }
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

/** The time Haven recorded the current-snapshot figures, when there is one. */
export const snapshotAsOf = (report?: StandUpReport): string | null => report?.source_as_of ?? null

/**
 * What the review step has to keep apart. Every figure being populated is not
 * an administrator's review, an administrator's review is not a settled
 * counting rule, and none of the three is a submission. Each is stated on its
 * own row so the decision to submit is made against four separate facts.
 */
export function submissionChecklist(input: {
  report?: StandUpReport; dirty?: boolean; provided: number | null; total: number; unresolved: number
}): { term: string; detail: string }[] {
  const { report, dirty = false, provided, total, unresolved } = input
  const state = reportStatus(report, dirty).state
  return [
    { term: 'Figures provided', detail: provided === null ? 'Not countable while a figure needs correction' : provided === total ? `All ${total}` : `${provided} of ${total} — all ${total} are needed to submit` },
    { term: 'Administrator review', detail: state === 'Submitted' ? 'Confirmed by the last submission' : 'Not confirmed yet — submitting confirms yours' },
    { term: 'Unresolved definitions', detail: unresolved === 0 ? 'None' : `${unresolved} figures — Circle of Life has not settled how they are counted, so they stay provisional` },
    { term: 'Submission', detail: submissionEvidence(report) },
  ]
}

/** Figures that differ from the previous report, for the review step. */
export function changesFromPrevious(values: StandUpValues, previous: StandUpReport | undefined): string[] {
  if (!previous) return []
  return METRICS.filter(metric => values[metric.key] !== previous.values[metric.key])
    .map(metric => `${metric.label}: ${metricDisplay(metric.key, previous.values[metric.key])} to ${metricDisplay(metric.key, values[metric.key])}`)
}
