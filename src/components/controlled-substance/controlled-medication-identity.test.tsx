import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  formatControlledMedicationIdentity,
  formatMedicationDose,
  formatResidentIdentity,
  requireControlledMedicationResidentIdentities,
} from "@/lib/medications/controlled-count-identity";
import { PendingCountReceipt } from "./PendingCountReceipt";

describe("controlled medication identity", () => {
  const medication = {
    id: "medication-record-42",
    medication_name: "Morphine",
    strength: "10 mg",
    form: "tablet",
    route: "oral",
    frequency: "daily",
    residents: {
      first_name: "Marian",
      middle_name: "E.",
      last_name: "Rivera",
      name_suffix: null,
      preferred_name: "Mary",
    },
  };

  it("keeps the supported resident, dose, and medication-record identity together", () => {
    expect(formatResidentIdentity(medication.residents)).toBe("Marian E. Rivera (Mary)");
    expect(formatMedicationDose(medication)).toBe("10 mg tablet · oral · daily");
    expect(formatControlledMedicationIdentity(medication)).toContain("Medication record: medication-record-42");
  });

  it("repeats the full identity on the independent witness receipt", () => {
    const label = formatControlledMedicationIdentity(medication);
    render(
      <PendingCountReceipt
        counts={[{ id: "count-1", resident_medication_id: medication.id, count_date: "2026-09-07", shift: "evening", expected_count: 8, actual_count: 7 }]}
        medicationLabels={new Map([[medication.id, label]])}
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/expected 8, counted 7/)).toBeInTheDocument();
  });

  it("blocks an ambiguous medication record before staff can enter a count", () => {
    expect(() =>
      requireControlledMedicationResidentIdentities([
        { residents: null },
      ]),
    ).toThrow("missing its resident identity");
  });

  it("keeps a stable medication-record identifier visible if a pending receipt cannot resolve its label", () => {
    render(
      <PendingCountReceipt
        counts={[{ id: "count-2", resident_medication_id: "medication-record-unknown", count_date: "2026-09-07", shift: "evening", expected_count: 4, actual_count: 4 }]}
        medicationLabels={new Map()}
      />,
    );

    expect(screen.getByText("Medication record: medication-record-unknown")).toBeInTheDocument();
  });
});
