import { describe, expect, it } from "vitest";

import {
  TIMELINE_TAB_NO_EVENTS_COPY,
  createDefaultTimelineEventForm,
} from "./timeline-tab-display-copy";

const EM_DASH = "—";

describe("createDefaultTimelineEventForm", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("defaults event_date to Eastern calendar today at 8:05pm ET, not UTC ISO slice", () => {
    const form = createDefaultTimelineEventForm(eightOhFivePmEt);

    expect(form.event_date).toBe("2026-08-20");
    expect(form.event_date).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("returns a blank title and other event type", () => {
    const form = createDefaultTimelineEventForm(eightOhFivePmEt);

    expect(form.event_type).toBe("other");
    expect(form.title).toBe("");
    expect(form.description).toBe("");
  });
});

describe("TIMELINE_TAB_NO_EVENTS_COPY", () => {
  it("names an empty timeline instead of a silent dash", () => {
    expect(TIMELINE_TAB_NO_EVENTS_COPY).toMatch(/no timeline events recorded yet/i);
    expect(TIMELINE_TAB_NO_EVENTS_COPY).toMatch(/add an event/i);
    expect(TIMELINE_TAB_NO_EVENTS_COPY).not.toBe(EM_DASH);
  });
});
