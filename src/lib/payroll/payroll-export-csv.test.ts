import { describe, expect, it } from 'vitest';
import { buildPayrollLinesCsvFlat, buildPayrollLinesCsvGeneric, buildPayrollLinesCsvVendorHandoff, buildPayrollLinesCsvHoursSplit, type PayrollExportLineRow } from './payroll-export-csv';
const line = (payload: Record<string, unknown>): PayrollExportLineRow => ({ line_kind: 'time_record_hours', amount_cents: null, idempotency_key: 'time_record:one', payload, staff: { first_name: 'A', last_name: 'Worker' } });
describe('payroll export readiness', () => {
 it('rejects timestamp-only uncomputed punches in every format', () => {
  const rows = [line({ actual_hours: null, regular_hours: null, overtime_hours: null })];
  for (const build of [() => buildPayrollLinesCsvFlat(rows), () => buildPayrollLinesCsvGeneric(rows), () => buildPayrollLinesCsvVendorHandoff(rows,{ period_start:'2026-09-01',period_end:'2026-09-07'}), () => buildPayrollLinesCsvHoursSplit(rows,{period_start:'2026-09-01',period_end:'2026-09-07'})]) expect(build).toThrow(/hours/i);
 });
 it('rejects an overtime split that has not been reviewed', () => {
  expect(() => buildPayrollLinesCsvHoursSplit([line({actual_hours: 8,regular_hours:null,overtime_hours:null})], {period_start:'2026-09-01',period_end:'2026-09-07'})).toThrow(/split/i);
 });
 it('preserves computed worked hours', () => { expect(buildPayrollLinesCsvFlat([line({ actual_hours: 7.5 })])).toContain(',7.5,'); });
});
