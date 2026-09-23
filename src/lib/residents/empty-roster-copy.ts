/**
 * One sentence for a facility whose roster has no residents (COL-670). Admin
 * home, the floor app and the report flow all say the same thing, so an empty
 * building reads as "nobody is on the roster yet", not as blank tiles.
 */
export function emptyRosterCopy(facilityName: string | null | undefined): string {
  const name = facilityName?.trim();
  return `No residents are on the roster for ${name || "this facility"} yet.`;
}

/**
 * Stand Up's census and the roster disagree: one message that names both
 * numbers and what to do, never two unrelated figures (COL-670).
 */
export function censusDisagreementCopy(input: {
  facilityName: string | null | undefined;
  rosterTotal: number;
  standUpValue: number;
  standUpWeekStart: string;
}): string {
  const reported = `Weekly Stand Up reported ${input.standUpValue} for the week of ${input.standUpWeekStart}`;
  if (input.rosterTotal === 0) {
    return `${emptyRosterCopy(input.facilityName)} ${reported}, so those residents are not in Haven yet: add them through an admission, or correct the Stand Up census.`;
  }
  return `${reported}; the roster shows ${input.rosterTotal}. Check the roster against who is in the building, then correct whichever is wrong.`;
}
