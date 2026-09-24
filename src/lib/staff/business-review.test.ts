import { expect, it } from 'vitest';
import { dedupeStaffDirectoryRecords, type StaffDirectorySourceRow } from './load-staff';
import { evaluateStaffCertifications } from './certification-aggregate';
it('preserves independent staff IDs and their linked records even for matching names', () => {
 const base = {facility_id:'f',user_id:null,first_name:'Same',last_name:'Name',email:null,staff_role:'caregiver',employment_status:'active',photo_url:null,updated_at:'2026-09-01',deleted_at:null};
 expect(dedupeStaffDirectoryRecords([{...base,id:'a'},{...base,id:'b'}] as StaffDirectorySourceRow[]).map(x=>x.id)).toEqual(['a','b']);
});

it("does not mark absent credential evidence current", () => {
 const policy = { configured: true, requiredTypesByRole: new Map([["cna", new Set(["cna"])]]), expiringSoonDays: 60 };
 expect(evaluateStaffCertifications({ staffRole: "cna", certs: [], policy }).status).toBe("missing_required");
});

import { isAutoResignationNoCallNoShow, requiresPhysicianStatement } from './employment-rules';
import { shouldResetAbsenceCounter } from './discipline';

it('never automatically resigns an employee or resets attendance history', () => {
 expect(isAutoResignationNoCallNoShow()).toBe(false);
 expect(shouldResetAbsenceCounter(new Date('2020-01-01'), new Date('2026-09-08'))).toBe(false);
 expect(shouldResetAbsenceCounter(null)).toBe(false);
});

it('uses more than three consecutive absence days for the draft physician-statement flag', () => {
 expect(requiresPhysicianStatement(3)).toBe(false);
 expect(requiresPhysicianStatement(4)).toBe(true);
});
