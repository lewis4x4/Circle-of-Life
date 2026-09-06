import { expect, it } from 'vitest';
import { aggregateCertStatus, dedupeStaffDirectoryRecords, type StaffDirectorySourceRow } from './load-staff';
it('preserves independent staff IDs and their linked records even for matching names', () => {
 const base = {facility_id:'f',user_id:null,first_name:'Same',last_name:'Name',email:null,staff_role:'caregiver',employment_status:'active',photo_url:null,updated_at:'2026-09-01',deleted_at:null};
 expect(dedupeStaffDirectoryRecords([{...base,id:'a'},{...base,id:'b'}] as StaffDirectorySourceRow[]).map(x=>x.id)).toEqual(['a','b']);
});

it("does not mark absent credential evidence current", () => { expect(aggregateCertStatus([])).toBe("not_verified"); });
