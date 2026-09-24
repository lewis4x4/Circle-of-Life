import { METRIC_KEYS, metricDisplay, type MetricKey, type StandUpValues } from './model'
import { ROSTER_FIELD_KEYS, type RosterFieldKey } from './roster-census'

/**
 * COL-753: Monday arrives prefilled from Haven and the administrator verifies it
 * (Brian, 2026-09-24: "10000%").
 *
 * The server computes every figure it can (`haven.stand_up_monday_prefill`,
 * migration 522) with the source it came from and when it was computed. A
 * figure Haven cannot compute arrives as null with the reason, never as 0
 * (COL-649). On save the server recomputes the prefill and records, per figure,
 * whether the saved figure is Haven's, differs (with the reason chosen here) or
 * had nothing to compare with. Census and hospital keep their roster
 * confirmation (COL-351): the roster is their prefill.
 */
export type PrefillField = { value: number | null; source: string | null; note?: string | null }
export type MondayPrefill = { facility_id: string; week_start: string; computed_at: string; fields: Partial<Record<MetricKey, PrefillField>> }

/** Figures confirmed against the prefill; census and hospital are confirmed against the roster instead. */
export const PREFILL_KEYS: MetricKey[] = METRIC_KEYS.filter(key => !(ROSTER_FIELD_KEYS as readonly string[]).includes(key))
export type PrefillKey = Exclude<MetricKey, RosterFieldKey>
export const isPrefillKey = (key: string): key is PrefillKey => (PREFILL_KEYS as string[]).includes(key)

export const PREFILL_SOURCES = ['haven_confirmed', 'overridden', 'entered_no_source'] as const
export type PrefillSource = typeof PREFILL_SOURCES[number]

/** Fixed reasons, like the roster's: free text invites resident names. The server holds the same list. */
export const PREFILL_OVERRIDE_REASONS = [
  { key: 'haven_not_current', label: 'Haven is not up to date' },
  { key: 'counted_differently', label: 'We count this differently' },
  { key: 'other', label: 'Other' },
] as const
export type PrefillOverrideReason = typeof PREFILL_OVERRIDE_REASONS[number]['key']
export const isPrefillOverrideReason = (value: string): value is PrefillOverrideReason => PREFILL_OVERRIDE_REASONS.some(reason => reason.key === value)
export const prefillReasonLabel = (reason: PrefillOverrideReason): string => PREFILL_OVERRIDE_REASONS.find(item => item.key === reason)!.label

/** What the server recorded for one figure on one saved revision. */
export type PrefillConfirmation = {
  source: PrefillSource; haven_value: number | null; confirmed: number
  override_reason: PrefillOverrideReason | null; haven_source: string | null; computed_at: string; confirmed_at: string
}
export type PrefillConfirmations = Partial<Record<PrefillKey, PrefillConfirmation>>

/** The client's part of a save: a reason per figure that differs. The server decides the source. */
export type PrefillPayload = Partial<Record<PrefillKey, { override_reason: PrefillOverrideReason }>>

export function prefillValue(prefill: MondayPrefill | null | undefined, key: MetricKey): number | null {
  const value = prefill?.fields[key]?.value
  return typeof value === 'number' ? value : null
}

/** The source the server will record for a typed figure, so the form can ask for a reason before submitting. */
export function expectedPrefillSource(prefill: MondayPrefill | null | undefined, key: MetricKey, value: number | null): PrefillSource | null {
  if (value === null || !prefill) return null
  const haven = prefillValue(prefill, key)
  if (haven === null) return 'entered_no_source'
  return value === haven ? 'haven_confirmed' : 'overridden'
}

/**
 * The values a report that has not started opens with: Haven's figure where it
 * has one, blank where it does not. A blank is never filled with 0.
 */
export function prefilledValues(prefill: MondayPrefill, base: StandUpValues): StandUpValues {
  const next = { ...base }
  for (const key of METRIC_KEYS) {
    const value = prefillValue(prefill, key)
    if (next[key] === null && value !== null) next[key] = value
  }
  return next
}

/** "Haven: $117,108.00 · Invoices in Haven: …" or why Haven has no figure. */
export function prefillLine(prefill: MondayPrefill, key: MetricKey): string {
  const field = prefill.fields[key]
  if (!field) return 'Haven does not compute this figure'
  if (field.value === null) return `Haven cannot compute this: ${field.note ?? 'no source in Haven'}`
  return `Haven: ${metricDisplay(key, field.value)} · ${field.source}`
}

/** The message that blocks submitting while a differing figure has no reason. */
export function prefillIssueMessage(label: string, key: MetricKey, haven: number): string {
  return `${label} differs from Haven (${metricDisplay(key, haven)}). Choose why it is different, or use Haven’s figure.`
}

/** What a saved report recorded at the time. The prefill is never recomputed for a past meeting. */
export function recordedPrefillLine(key: MetricKey, confirmation: PrefillConfirmation | undefined): string | null {
  if (!confirmation) return null
  if (confirmation.source === 'entered_no_source') return 'Entered where Haven had no figure'
  const haven = metricDisplay(key, confirmation.haven_value)
  if (confirmation.source === 'haven_confirmed') return `Confirmed from Haven (${haven})`
  return `Haven had ${haven}${confirmation.override_reason ? ` · override: ${prefillReasonLabel(confirmation.override_reason)}` : ' · no reason given yet'}`
}

/** Figures typed differently from Haven that still need a reason before submitting. */
export function prefillIssues(prefill: MondayPrefill | null | undefined, values: StandUpValues, reasons: Partial<Record<PrefillKey, PrefillOverrideReason>>): PrefillKey[] {
  if (!prefill) return []
  return (PREFILL_KEYS as PrefillKey[]).filter(key => expectedPrefillSource(prefill, key, values[key]) === 'overridden' && !reasons[key])
}
