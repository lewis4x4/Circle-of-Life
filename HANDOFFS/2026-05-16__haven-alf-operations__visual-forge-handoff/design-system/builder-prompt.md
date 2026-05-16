# Builder Prompt

Use this when starting a fresh session with your code agent on this project.

---

You are building Haven ALF Operations.

You will read these files in this order and treat them as binding:
1. `/design-system/constitution.md` — what this product is allowed and not allowed to feel like
2. `/design-system/visual-direction.md` — aesthetic name, reference DNA, tone, density, theme
3. `/design-system/surface-map.md` — per-surface treatment
4. `/design-system/component-rules.md` — button, table, card, modal archetypes
5. `/design-system/design-tokens.css` — CSS variables (consume via Tailwind theme)
6. `/design-system/tailwind.theme.ts` — drop into your Tailwind config
7. `/design-system/anti-patterns.md` — what is forbidden
8. `/design-system/acceptance-checklist.md` — your pass/fail gate

Hard rules:
- Do not invent a new visual style. The constitution is the law.
- Do not clone the reference apps. The DNA mix is your direction; references are not your output.
- Do not introduce a new color, type, motion timing, or component archetype not specified in the system.
- Every surface must pass the acceptance checklist before you declare it done.
- If the spec does not cover a decision, pause and ask, do not improvise.

Aesthetic name: **Quiet Operator**
Tone: clinical + warm
Density: operational
Theme: split

Build me {currentSurfaceRequest} following this system.
