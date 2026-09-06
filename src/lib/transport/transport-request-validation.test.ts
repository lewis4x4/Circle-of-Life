import { expect, it } from 'vitest';
import { isCredentialDateValid } from './transport-request-validation';
it('checks a license through the appointment date rather than the current day', () => {
 expect(isCredentialDateValid('2026-09-10','2026-09-11')).toBe(false);
 expect(isCredentialDateValid('2026-09-11','2026-09-11')).toBe(true);
 expect(isCredentialDateValid(null,'2026-09-11')).toBe(false);
 expect(isCredentialDateValid('2026-99-99','2026-09-11')).toBe(false);
});
