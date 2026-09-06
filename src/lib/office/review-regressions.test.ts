import { expect, it } from 'vitest';
import { migrationComplete, rollupFromStatuses } from './drive-cutover';
it('does not certify migrated content from bookmarks or skipped files', () => {
 expect(migrationComplete({batches:1,...rollupFromStatuses(['imported'])})).toBe(false);
 expect(migrationComplete({batches:1,...rollupFromStatuses(['skipped'])})).toBe(false);
});

import { masterCalendarTimestampBounds } from './master-calendar';
it('includes late Eastern meetings and DST boundaries', () => {
 expect(masterCalendarTimestampBounds('2026-09-01','2026-09-01')).toEqual({start:'2026-09-01T04:00:00.000Z',end:'2026-09-02T03:59:59.999Z'});
 expect(masterCalendarTimestampBounds('2026-11-01','2026-11-01')).toEqual({start:'2026-11-01T04:00:00.000Z',end:'2026-11-02T04:59:59.999Z'});
});
