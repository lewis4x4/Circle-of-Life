import { describe, expect, it } from "vitest";

import { resolveModuleContext } from "./context-map";

const TWO_WAY_CHAT_MARKERS = [
  "unread family messages",
  "chat inbox",
  "needs response",
  "reply to family",
];

const FAMILY_ADMIN_ROUTES = [
  "/admin/family",
  "/admin/family-portal",
  "/admin/family-portal/consents/new",
  "/admin/family-messages",
];

function operatorFacingText(context: ReturnType<typeof resolveModuleContext>): string {
  return [context.module, context.perspective, ...context.suggestedQuestions].join("\n");
}

describe("family admin insight context is one-way bulletin", () => {
  it.each(FAMILY_ADMIN_ROUTES)("does not describe two-way chat for %s", (route) => {
    const context = resolveModuleContext(route);
    const text = operatorFacingText(context).toLowerCase();

    for (const marker of TWO_WAY_CHAT_MARKERS) {
      expect(text, `${route} still suggests ${marker}`).not.toContain(marker);
    }

    expect(context.systemPromptAddon.toLowerCase()).toMatch(/one-way|bulletin/);
    expect(context.systemPromptAddon.toLowerCase()).toMatch(
      /cannot reply|no family replies|do not describe family replies/,
    );
  });

  it("uses bulletin-specific context on family-messages", () => {
    const context = resolveModuleContext("/admin/family-messages");
    expect(context.module).toBe("Family Bulletin Notes");
    expect(context.perspective).toMatch(/one-way/i);
    expect(context.suggestedQuestions.some((q) => /posted|bulletin/i.test(q))).toBe(true);
  });

  it("uses hub context on family-portal", () => {
    const context = resolveModuleContext("/admin/family-portal");
    expect(context.module).toBe("Family Portal Hub");
    expect(context.suggestedQuestions.some((q) => /conference|consent/i.test(q))).toBe(true);
  });
});
