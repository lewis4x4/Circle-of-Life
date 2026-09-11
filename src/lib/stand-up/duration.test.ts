import { describe, expect, it } from 'vitest';
import { formatOvertimeMinutes, legacyOvertimeToMinutes, overtimeMinuteParts, overtimeMinutesToLegacy, overtimePartsToLegacy } from './duration';

describe('Stand Up HH.MM overtime compatibility', () => {
  it('converts hours and minutes, not decimal hours', () => {
    expect(legacyOvertimeToMinutes(17.15)).toBe(1035);
    expect(legacyOvertimeToMinutes(17.5)).toBe(1070);
    expect(legacyOvertimeToMinutes(0.01)).toBe(1);
    expect(formatOvertimeMinutes(1035)).toBe('17h 15m');
  });
  it('distinguishes absent and explicit zero', () => {
    expect(legacyOvertimeToMinutes(null)).toBeNull();
    expect(legacyOvertimeToMinutes(0)).toBe(0);
    expect(overtimePartsToLegacy('', '')).toBeNull();
    expect(overtimePartsToLegacy('0', '')).toBe(0);
    expect(overtimeMinuteParts(null)).toEqual({ hours: '', minutes: '' });
    expect(formatOvertimeMinutes(0)).toBe('0h 0m');
  });
  it('rejects ambiguous or invalid minute components', () => {
    for (const value of [17.6, 17.99, 17.151, -1, Infinity, NaN, 2147483647]) {
      expect(() => legacyOvertimeToMinutes(value)).toThrow(RangeError);
    }
    for (const [h, m] of [['1.5', '0'], ['0', '60'], ['-1', '0'], ['0', '1.5']]) {
      expect(() => overtimePartsToLegacy(h, m)).toThrow(RangeError);
    }
  });
  it('rolls accumulated minutes into hours without HH.MM arithmetic', () => {
    const total = legacyOvertimeToMinutes(1.45)! + legacyOvertimeToMinutes(0.3)!;
    expect(overtimeMinutesToLegacy(total)).toBe(2.15);
    expect(overtimePartsToLegacy('17', '15')).toBe(17.15);
    expect(overtimeMinuteParts(1035)).toEqual({ hours: '17', minutes: '15' });
    expect(overtimeMinutesToLegacy(2147483647)).toBe(35791394.07);
    expect(legacyOvertimeToMinutes(35791394.07)).toBe(2147483647);
  });
});
