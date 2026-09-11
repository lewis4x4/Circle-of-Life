/** Legacy spreadsheet overtime is HH.MM; calculations always use integer minutes. */
export function legacyOvertimeToMinutes(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new RangeError('Enter overtime as whole hours and minutes.');
  }
  const [hours, fraction = ''] = String(value).split('.');
  const minutes = Number(fraction.padEnd(2, '0'));
  const total = Number(hours) * 60 + minutes;
  if (minutes > 59 || !Number.isSafeInteger(total) || total > 2147483647) {
    throw new RangeError('Overtime minutes must be between 0 and 59.');
  }
  return total;
}

export function overtimeMinutesToLegacy(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw new RangeError('Overtime duration must be whole, nonnegative minutes.');
  }
  return Number(`${Math.floor(value / 60)}.${String(value % 60).padStart(2, '0')}`);
}

export function overtimePartsToLegacy(hours: string, minutes: string): number | null {
  const h = hours.trim();
  const m = minutes.trim();
  if (!h && !m) return null;
  if ((h && !/^\d+$/.test(h)) || (m && !/^\d+$/.test(m)) || Number(m || 0) > 59) {
    throw new RangeError('Use whole hours and minutes from 0 to 59.');
  }
  return overtimeMinutesToLegacy(Number(h || 0) * 60 + Number(m || 0));
}

export function overtimeMinuteParts(value: number | null): { hours: string; minutes: string } {
  if (value === null) return { hours: '', minutes: '' };
  overtimeMinutesToLegacy(value);
  return { hours: String(Math.floor(value / 60)), minutes: String(value % 60) };
}

export function formatOvertimeMinutes(value: number | null): string {
  if (value === null) return 'Not provided';
  const { hours, minutes } = overtimeMinuteParts(value);
  return `${hours}h ${minutes}m`;
}
