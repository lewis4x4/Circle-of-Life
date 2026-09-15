import { describe, expect, it } from "vitest";

import { CARE_PLAN_NO_NAME_COPY } from "./care-plan-display-copy";
import { CARE_PLAN_PRINT_NO_ROOM_COPY } from "./care-plan-print-copy";
import {
  buildCarePlanPrintPacket,
  groupCarePlanPrintItems,
  type CarePlanPrintFacilityRow,
  type CarePlanPrintItemRow,
  type CarePlanPrintPlanRow,
  type CarePlanPrintResidentRow,
} from "./care-plan-print-packet";

const plan: CarePlanPrintPlanRow = {
  id: "plan-1",
  version: 2,
  status: "active",
  effective_date: "2026-09-10",
  review_due_date: "2027-09-10",
  notes: "Drafted from the paper ISP.",
  approved_at: "2026-09-12T14:00:00.000Z",
  signature_data: "data:image/png;base64,AAAA",
};

const resident: CarePlanPrintResidentRow = {
  id: "res-1",
  first_name: "Test",
  last_name: "Resident",
  date_of_birth: "1940-01-02",
  beds: [{ bed_label: "B", rooms: { room_number: "10" } }],
};

const facility: CarePlanPrintFacilityRow = {
  name: "Homewood Lodge",
  address_line_1: "430 Mills St",
  address_line_2: null,
  city: "Mayo",
  state: "FL",
  zip: "32066",
  phone: "386-294-2273",
  license_number: null,
};

function item(overrides: Partial<CarePlanPrintItemRow>): CarePlanPrintItemRow {
  return {
    id: "item",
    category: "other",
    title: "Title",
    description: "Description",
    assistance_level: "supervision",
    frequency: null,
    goal: null,
    interventions: null,
    special_instructions: null,
    sort_order: 0,
    ...overrides,
  };
}

describe("groupCarePlanPrintItems", () => {
  it("orders sections the way the category enum reads, not alphabetically", () => {
    const sections = groupCarePlanPrintItems([
      item({ id: "a", category: "dietary" }),
      item({ id: "b", category: "bathing" }),
      item({ id: "c", category: "mobility" }),
      item({ id: "d", category: "medication_assistance" }),
    ]);
    expect(sections.map((section) => section.category)).toEqual([
      "mobility",
      "bathing",
      "medication_assistance",
      "dietary",
    ]);
    expect(sections[0].label).toBe("Mobility");
  });

  it("keeps sort_order inside a section and drops blank intervention lines", () => {
    const sections = groupCarePlanPrintItems([
      item({ id: "second", category: "mobility", sort_order: 2, interventions: ["Walk with gait belt", "", "  "] }),
      item({ id: "first", category: "mobility", sort_order: 1 }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((row) => row.id)).toEqual(["first", "second"]);
    expect(sections[0].items[1].interventions).toEqual(["Walk with gait belt"]);
  });

  it("files an unknown or blank category under Other, after the known ones", () => {
    const sections = groupCarePlanPrintItems([
      item({ id: "x", category: "  " }),
      item({ id: "y", category: "eating" }),
    ]);
    expect(sections.map((section) => section.category)).toEqual(["eating", "other"]);
  });
});

describe("buildCarePlanPrintPacket", () => {
  it("assembles resident, facility, sections, and the signature block", () => {
    const packet = buildCarePlanPrintPacket({
      plan,
      items: [item({ id: "i1", category: "bathing" })],
      resident,
      facility,
      approverName: "Nurse Example",
      supersededByVersion: null,
      printedAt: "2026-09-15T21:00:00.000Z",
      printedBy: "Printer Example",
    });

    expect(packet.resident).toEqual({ id: "res-1", name: "Test Resident", dateOfBirth: "1940-01-02", room: "10-B" });
    expect(packet.facility.addressLines).toEqual(["430 Mills St", "Mayo, FL 32066"]);
    expect(packet.sections).toHaveLength(1);
    expect(packet.signature).toEqual({
      approvedAt: "2026-09-12T14:00:00.000Z",
      approverName: "Nurse Example",
      signatureData: "data:image/png;base64,AAAA",
    });
    expect(packet.plan.supersededByVersion).toBeNull();
    expect(packet.printedBy).toBe("Printer Example");
    expect(packet.acknowledgements).toEqual([]);
    expect(packet.form1823).toBeNull();
  });

  it("names the Form 1823 the version was drafted from", () => {
    const packet = buildCarePlanPrintPacket({
      plan,
      items: [],
      resident,
      facility,
      approverName: null,
      supersededByVersion: null,
      form1823: { exam_date: "2026-09-04", physician_name: "Examiner Example", examiner_title: "APRN" },
      printedAt: "2026-09-15T21:00:00.000Z",
      printedBy: "Printer Example",
    });
    expect(packet.form1823).toEqual({ examDate: "2026-09-04", examinerName: "Examiner Example", examinerTitle: "APRN" });
  });

  it("carries acknowledgements newest first with the signer's relationship", () => {
    const packet = buildCarePlanPrintPacket({
      plan,
      items: [],
      resident,
      facility,
      approverName: null,
      supersededByVersion: null,
      acknowledgements: [
        { id: "old", signer_role: "resident", signer_name: "Test Resident", relationship_to_resident: null, method: "verbal_review", signature_data: null, acknowledged_at: "2026-09-12T15:00:00.000Z" },
        { id: "new", signer_role: "responsible_party", signer_name: "Alice Example", relationship_to_resident: "daughter", method: "in_person_signature", signature_data: "data:image/png;base64,BBBB", acknowledged_at: "2026-09-13T15:00:00.000Z" },
      ],
      printedAt: "2026-09-15T21:00:00.000Z",
      printedBy: "Printer Example",
    });
    expect(packet.acknowledgements.map((a) => a.id)).toEqual(["new", "old"]);
    expect(packet.acknowledgements[0]).toMatchObject({ signerRole: "responsible_party", relationship: "daughter", signatureData: "data:image/png;base64,BBBB" });
  });

  it("has no signature block until the plan was approved, even if signature bytes exist", () => {
    const packet = buildCarePlanPrintPacket({
      plan: { ...plan, status: "draft", approved_at: null },
      items: [],
      resident,
      facility,
      approverName: null,
      supersededByVersion: null,
      printedAt: "2026-09-15T21:00:00.000Z",
      printedBy: "Printer Example",
    });
    expect(packet.signature).toBeNull();
    expect(packet.sections).toEqual([]);
  });

  it("names a missing resident name and an unlinked bed instead of inventing them", () => {
    const packet = buildCarePlanPrintPacket({
      plan,
      items: [],
      resident: { id: "res-2", first_name: "", last_name: null, date_of_birth: null, beds: [] },
      facility: { ...facility, address_line_1: null, city: null, state: null, zip: null },
      approverName: null,
      supersededByVersion: 3,
      printedAt: "2026-09-15T21:00:00.000Z",
      printedBy: "Printer Example",
    });
    expect(packet.resident.name).toBe(CARE_PLAN_NO_NAME_COPY);
    expect(packet.resident.room).toBe(CARE_PLAN_PRINT_NO_ROOM_COPY);
    expect(packet.facility.addressLines).toEqual([]);
    expect(packet.plan.supersededByVersion).toBe(3);
  });
});
