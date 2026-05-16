import { describe, expect, it } from "vitest";
import { tokens } from "./tokens";

describe("UI-V2 tokens", () => {
  it("matches the approved design-system token contract", () => {
    expect(tokens).toMatchInlineSnapshot(`
      {
        "color": {
          "bg": {
            "app": "#0B0B09",
            "border": "rgba(255,255,255,0.06)",
            "borderStrong": "rgba(255,255,255,0.12)",
            "surface": "#161613",
            "surfaceElevated": "#1A1A17",
            "surfaceSubtle": "#0F0F0D",
          },
          "brand": {
            "accent": "#436b87",
            "primary": "#678fab",
            "primaryHover": "#779fbb",
          },
          "semantic": {
            "danger": "#C26152",
            "info": "#6A8FA8",
            "neutral": "#928E85",
            "regulatory": "rgb(139 92 246)",
            "success": "#7A9B5E",
            "warning": "#D49B5C",
          },
          "text": {
            "inverse": "#1A0F08",
            "muted": "#928E85",
            "primary": "#F5F2EA",
            "secondary": "#C5C0B5",
          },
        },
        "font": {
          "family": {
            "mono": "'Geist Mono', ui-monospace, monospace",
            "sans": "'Geist Sans', system-ui, sans-serif",
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
          "base": "240ms",
          "ease": "cubic-bezier(0.16, 1, 0.3, 1)",
          "fast": "160ms",
          "slow": "360ms",
        },
        "radius": {
          "full": "9999px",
          "lg": "12px",
          "md": "8px",
          "sm": "6px",
          "xl": "16px",
        },
        "shadow": {
          "card": "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 16px 36px -20px rgba(0, 0, 0, 0.5)",
          "panel": "0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 28px 56px -24px rgba(0, 0, 0, 0.7)",
          "popover": "0 0 0 1px rgba(103, 143, 171, 0.4), 0 0 24px rgba(103, 143, 171, 0.18)",
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
