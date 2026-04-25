import { describe, expect, it } from "vitest";
import { tokens } from "./tokens";

describe("UI-V2 tokens", () => {
  it("matches the approved design-system token contract", () => {
    expect(tokens).toMatchInlineSnapshot(`
      {
        "color": {
          "bg": {
            "app": "rgb(11 16 28)",
            "border": "rgb(39 51 74)",
            "borderStrong": "rgb(56 72 101)",
            "surface": "rgb(18 25 40)",
            "surfaceElevated": "rgb(25 33 50)",
            "surfaceSubtle": "rgb(15 21 34)",
          },
          "brand": {
            "accent": "rgb(139 92 246)",
            "primary": "rgb(59 130 246)",
            "primaryHover": "rgb(37 99 235)",
          },
          "semantic": {
            "danger": "rgb(239 68 68)",
            "info": "rgb(59 130 246)",
            "neutral": "rgb(100 116 139)",
            "regulatory": "rgb(139 92 246)",
            "success": "rgb(34 197 94)",
            "warning": "rgb(245 158 11)",
          },
          "text": {
            "inverse": "rgb(11 16 28)",
            "muted": "rgb(115 132 158)",
            "primary": "rgb(237 242 251)",
            "secondary": "rgb(160 176 201)",
          },
        },
        "font": {
          "family": {
            "mono": "'JetBrains Mono', 'IBM Plex Mono', monospace",
            "sans": "'Inter', system-ui, sans-serif",
          },
          "size": {
            "2xl": "28px",
            "3xl": "36px",
            "base": "14px",
            "hero": "48px",
            "lg": "18px",
            "md": "15px",
            "sm": "12px",
            "xl": "22px",
            "xs": "11px",
          },
          "tracking": {
            "caps": "0.08em",
            "normal": "0",
            "tight": "-0.01em",
            "wide": "0.02em",
          },
          "weight": {
            "bold": 700,
            "medium": 500,
            "regular": 400,
            "semibold": 600,
          },
        },
        "motion": {
          "base": "180ms",
          "ease": "cubic-bezier(0.4, 0, 0.2, 1)",
          "fast": "120ms",
          "slow": "260ms",
        },
        "radius": {
          "full": "9999px",
          "lg": "12px",
          "md": "8px",
          "sm": "6px",
          "xl": "16px",
        },
        "shadow": {
          "card": "0 1px 2px rgba(0,0,0,0.2), 0 0 0 1px rgb(39 51 74)",
          "panel": "0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgb(39 51 74)",
          "popover": "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgb(56 72 101)",
        },
        "space": {
          "1": "4px",
          "10": "40px",
          "12": "48px",
          "2": "8px",
          "3": "12px",
          "4": "16px",
          "5": "20px",
          "6": "24px",
          "8": "32px",
        },
      }
    `);
  });
});
