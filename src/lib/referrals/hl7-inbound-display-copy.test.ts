import { describe, expect, it } from "vitest";

import {
  HL7_INBOUND_NO_MESSAGE_CONTROL_ID_COPY,
  HL7_INBOUND_NO_TRIGGER_EVENT_COPY,
  formatHl7InboundMessageControlId,
  formatHl7InboundTriggerEvent,
} from "./hl7-inbound-display-copy";

const EM_DASH = "—";

describe("formatHl7InboundMessageControlId", () => {
  it("names a missing message control id instead of an em dash", () => {
    expect(formatHl7InboundMessageControlId(null)).toBe(
      HL7_INBOUND_NO_MESSAGE_CONTROL_ID_COPY,
    );
    expect(formatHl7InboundMessageControlId("")).toBe(
      HL7_INBOUND_NO_MESSAGE_CONTROL_ID_COPY,
    );
    expect(formatHl7InboundMessageControlId("   ")).toBe(
      HL7_INBOUND_NO_MESSAGE_CONTROL_ID_COPY,
    );
    expect(formatHl7InboundMessageControlId(null)).not.toBe(EM_DASH);
  });

  it("returns a posted message control id trimmed", () => {
    expect(formatHl7InboundMessageControlId("MSG-2026-001")).toBe("MSG-2026-001");
    expect(formatHl7InboundMessageControlId("  MSG-2026-002  ")).toBe("MSG-2026-002");
  });
});

describe("formatHl7InboundTriggerEvent", () => {
  it("names a missing trigger event instead of an em dash", () => {
    expect(formatHl7InboundTriggerEvent(null)).toBe(HL7_INBOUND_NO_TRIGGER_EVENT_COPY);
    expect(formatHl7InboundTriggerEvent("")).toBe(HL7_INBOUND_NO_TRIGGER_EVENT_COPY);
    expect(formatHl7InboundTriggerEvent("   ")).toBe(HL7_INBOUND_NO_TRIGGER_EVENT_COPY);
    expect(formatHl7InboundTriggerEvent(null)).not.toBe(EM_DASH);
  });

  it("returns a posted trigger event trimmed", () => {
    expect(formatHl7InboundTriggerEvent("A01")).toBe("A01");
    expect(formatHl7InboundTriggerEvent("  A04  ")).toBe("A04");
  });
});
