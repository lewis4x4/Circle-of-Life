import { describe, expect, it } from "vitest";

import {
  AUDIT_LOG_NO_ACTOR_COPY,
  AUDIT_LOG_NO_FACILITY_COPY,
  AUDIT_LOG_NO_NOTE_COPY,
  formatAuditLogActorIdDisplay,
  formatAuditLogFacilityIdDisplay,
  formatAuditLogNoteDisplay,
} from "./audit-log-display-copy";

const PLACEHOLDER_FACILITY_ID = "11111111-2222-3333-4444-555555555555";
const PLACEHOLDER_ACTOR_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PLACEHOLDER_NOTE = "Alert acknowledged from settings review";

describe("formatAuditLogFacilityIdDisplay", () => {
  it("names missing facility instead of a silent dash", () => {
    expect(formatAuditLogFacilityIdDisplay(null)).toBe(AUDIT_LOG_NO_FACILITY_COPY);
    expect(formatAuditLogFacilityIdDisplay(undefined)).toBe(AUDIT_LOG_NO_FACILITY_COPY);
    expect(formatAuditLogFacilityIdDisplay("")).toBe(AUDIT_LOG_NO_FACILITY_COPY);
    expect(formatAuditLogFacilityIdDisplay("   ")).toBe(AUDIT_LOG_NO_FACILITY_COPY);
  });

  it("truncates posted facility ids to eight characters plus ellipsis", () => {
    expect(formatAuditLogFacilityIdDisplay(PLACEHOLDER_FACILITY_ID)).toBe("11111111…");
  });
});

describe("formatAuditLogActorIdDisplay", () => {
  it("names missing actor instead of a silent dash", () => {
    expect(formatAuditLogActorIdDisplay(null)).toBe(AUDIT_LOG_NO_ACTOR_COPY);
    expect(formatAuditLogActorIdDisplay(undefined)).toBe(AUDIT_LOG_NO_ACTOR_COPY);
    expect(formatAuditLogActorIdDisplay("")).toBe(AUDIT_LOG_NO_ACTOR_COPY);
    expect(formatAuditLogActorIdDisplay("   ")).toBe(AUDIT_LOG_NO_ACTOR_COPY);
  });

  it("truncates posted actor ids to eight characters plus ellipsis", () => {
    expect(formatAuditLogActorIdDisplay(PLACEHOLDER_ACTOR_ID)).toBe("aaaaaaaa…");
  });
});

describe("formatAuditLogNoteDisplay", () => {
  it("names missing note instead of a silent dash", () => {
    expect(formatAuditLogNoteDisplay(null)).toBe(AUDIT_LOG_NO_NOTE_COPY);
    expect(formatAuditLogNoteDisplay(undefined)).toBe(AUDIT_LOG_NO_NOTE_COPY);
    expect(formatAuditLogNoteDisplay("")).toBe(AUDIT_LOG_NO_NOTE_COPY);
    expect(formatAuditLogNoteDisplay("   ")).toBe(AUDIT_LOG_NO_NOTE_COPY);
  });

  it("returns posted note trimmed as-is", () => {
    expect(formatAuditLogNoteDisplay(PLACEHOLDER_NOTE)).toBe(PLACEHOLDER_NOTE);
    expect(formatAuditLogNoteDisplay(`  ${PLACEHOLDER_NOTE}  `)).toBe(PLACEHOLDER_NOTE);
  });
});
