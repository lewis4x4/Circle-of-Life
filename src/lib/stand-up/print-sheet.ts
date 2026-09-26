import { FIELD_DEFINITIONS } from './field-definitions'
import { METRICS, SECTIONS, dateLabel, fieldDisplay, reportState, sectionMetrics, sectionPeriodLabel, type MetricKey, type StandUpReport } from './model'
import { recordedPrefillLine } from './prefill'
import { isRosterFieldKey, recordedConfirmationLine } from './roster-census'
import { snapshotAsOf, submissionEvidence } from './report-presentation'

/**
 * A6 (Michelle Norris, 2026-09-22): Haven replaces the printed Stand Up form,
 * but buildings will print it for a hard-copy log binder for a while, so the
 * printout has to be complete on its own: which building and week, whether it
 * was submitted and by whom, every figure under the period it describes, what
 * Haven's own records said, the previous figure, and what each figure counts.
 *
 * Built from exactly what the Stand Up command returned. Nothing is recomputed
 * for a printout; a past meeting prints as it was recorded.
 */
export type PrintRow = { key: MetricKey; label: string; value: string; previous: string | null; checked: string | null; definition: string }
export type PrintSection = { key: string; label: string; period: string; rows: PrintRow[] }
export type StandUpPrint = { title: string; facility: string; week: string; state: string; evidence: string; sections: PrintSection[]; definitionsNote: string }

export function buildStandUpPrint(input: { facilityName: string; week: string; report?: StandUpReport; prior?: StandUpReport }): StandUpPrint {
  const { report, prior } = input
  const asOf = snapshotAsOf(report)
  return {
    title: 'Weekly Stand Up',
    facility: input.facilityName,
    week: `Meeting week of ${dateLabel(input.week)}`,
    state: reportState(report),
    evidence: submissionEvidence(report),
    sections: SECTIONS.map(section => ({
      key: section.key,
      label: section.label,
      period: sectionPeriodLabel(section, input.week, asOf, false),
      rows: sectionMetrics(section.key).map(metric => ({
        key: metric.key,
        label: metric.label,
        value: fieldDisplay(report, metric.key),
        previous: prior ? fieldDisplay(prior, metric.key) : null,
        checked: (isRosterFieldKey(metric.key) ? recordedConfirmationLine(report?.roster_confirmations?.[metric.key]) : null) ?? recordedPrefillLine(metric.key, report?.prefill_confirmations?.[metric.key]),
        definition: FIELD_DEFINITIONS[metric.key],
      })),
    })),
    definitionsNote: `Each figure counts what its definition says. ${METRICS.length} figures in all.`,
  }
}
