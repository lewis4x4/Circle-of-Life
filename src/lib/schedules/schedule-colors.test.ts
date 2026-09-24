import { describe, expect, it } from "vitest";
import { tokens } from "@/design-system/tokens";
import { contrastRatio, scheduleCellTone, scheduleToneStyle, SCHEDULE_TONE_ORDER, SCHEDULE_TONES } from "./schedule-colors";
import { COOK_SPLIT } from "./week-grid";

const day = { shiftType: "day", start: "06:00:00" };
const night = { shiftType: "night", start: "18:00:00" };

describe("schedule color key (COL-795)", () => {
  it("locks one color map for every building in shared design tokens", () => {
    expect(SCHEDULE_TONES).toBe(tokens.color.schedule);
    expect(SCHEDULE_TONE_ORDER).toEqual(["day", "night", "cook", "admin"]);
    expect(tokens.color.schedule).toEqual({
      day: { fill: "#F9A8D4", text: "#111111", label: "Day" },
      night: { fill: "#93C5FD", text: "#111111", label: "Night" },
      cook: { fill: "#86EFAC", text: "#111111", label: "Cook" },
      admin: { fill: "#000000", text: "#FFFFFF", label: "Administrator / Manager" },
    });
  });

  it("reads pink, blue, green and black", () => {
    const hue = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    const [pr, pg, pb] = hue(SCHEDULE_TONES.day.fill);
    expect(pr).toBeGreaterThan(pg);
    expect(pr).toBeGreaterThan(pb);
    expect(pb).toBeGreaterThan(pg);
    const [br, bg, bb] = hue(SCHEDULE_TONES.night.fill);
    expect(bb).toBeGreaterThan(br);
    expect(bb).toBeGreaterThan(bg);
    const [gr, gg, gb] = hue(SCHEDULE_TONES.cook.fill);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
    expect(SCHEDULE_TONES.admin.fill).toBe("#000000");
    expect(new Set(SCHEDULE_TONE_ORDER.map((tone) => SCHEDULE_TONES[tone].fill)).size).toBe(4);
  });

  it.each(SCHEDULE_TONE_ORDER)("%s text meets WCAG AA on its fill", (tone) => {
    expect(contrastRatio(SCHEDULE_TONES[tone].fill, SCHEDULE_TONES[tone].text)).toBeGreaterThanOrEqual(4.5);
  });

  it("computes WCAG contrast correctly", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(() => contrastRatio("pink", "#FFFFFF")).toThrow();
  });

  it("maps shifts to pink and blue, cooks to green and administrators to black", () => {
    expect(scheduleCellTone({ staffRole: "medication_tech", cellValue: "definition-1", shift: day })).toBe("day");
    expect(scheduleCellTone({ staffRole: "medication_tech", cellValue: "definition-2", shift: night })).toBe("night");
    expect(scheduleCellTone({ staffRole: "cook", cellValue: "definition-1", shift: day })).toBe("cook");
    expect(scheduleCellTone({ staffRole: "cook", cellValue: "definition-2", shift: night })).toBe("cook");
    expect(scheduleCellTone({ staffRole: "resident_aide", cellValue: COOK_SPLIT, shift: { shiftType: "custom", start: "06:00" } })).toBe("cook");
    expect(scheduleCellTone({ staffRole: "administrator", cellValue: "definition-1", shift: day })).toBe("admin");
    expect(scheduleCellTone({ staffRole: "assistant_administrator", cellValue: "custom", shift: { shiftType: "custom", start: "08:00" } })).toBe("admin");
    expect(scheduleCellTone({ staffRole: "owner", cellValue: COOK_SPLIT, shift: day })).toBe("admin");
  });

  it("colors evening and custom shifts by when they start", () => {
    expect(scheduleCellTone({ staffRole: "cna", cellValue: "custom", shift: { shiftType: "custom", start: "09:15" } })).toBe("day");
    expect(scheduleCellTone({ staffRole: "cna", cellValue: "custom", shift: { shiftType: "custom", start: "22:00" } })).toBe("night");
    expect(scheduleCellTone({ staffRole: "cna", cellValue: "custom", shift: { shiftType: "custom", start: "05:59" } })).toBe("night");
    expect(scheduleCellTone({ staffRole: "cna", cellValue: "evening", shift: { shiftType: "evening", start: "14:00" } })).toBe("day");
    expect(scheduleCellTone({ staffRole: "cna", cellValue: "evening", shift: { shiftType: "evening", start: "18:00" } })).toBe("night");
  });

  it("leaves Off cells uncolored, whatever the role", () => {
    expect(scheduleCellTone({ staffRole: "administrator", cellValue: null })).toBeNull();
    expect(scheduleCellTone({ staffRole: "cook", cellValue: null })).toBeNull();
  });

  it("keeps fills when printed", () => {
    expect(scheduleToneStyle("night")).toEqual({ backgroundColor: "#93C5FD", color: "#111111", borderColor: "#93C5FD", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" });
  });
});
