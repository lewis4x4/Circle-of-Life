/**
 * What each money page's resident count counts (COL-667).
 *
 * Rent roll, Forecast and Concessions each count a different set of residents
 * at Homewood (43 / 34 / 24 on 2026-09-22; Concessions labels its own), and all three are right for their
 * question. The numbers only read as a contradiction when a page shows a bare
 * "N residents", so every count on a money page says its filter.
 */

function residents(count: number): string {
  return `${count} resident${count === 1 ? "" : "s"}`;
}

/** Rent roll: everyone in the building at any point in the month, moved out or not. */
export function rentRollResidentCountLabel(count: number, monthLabel: string): string {
  return `${residents(count)} on the ${monthLabel} roll (in the building at any point in the month)`;
}

/** Forecast: residents active today in the selected scope. */
export function forecastResidentCountLabel(count: number): string {
  return `${residents(count)} active today in scope`;
}

