# Haven brand expression — wordmark only (segment: shell chrome)

Current product chrome uses a **typed wordmark** — no standalone icon mark, badge, or “H circle” tile in shells.

## Wordmark specification

Implemented by `HavenShellBrandLink` in `src/components/layout/HavenShellBrandLink.tsx`:

| Attribute | Choice |
|-----------|--------|
| **Typeface** | Geist Sans (`font-sans` / `--font-sans` from root layout) |
| **Size** | `14px` (`text-[14px]`), matches prior inline “Haven” label sizing — do **not** scale up |
| **`H` stroke** | `font-bold` (700) |
| **`aven`** | `font-semibold` (600) |
| **Letterspacing** | `tracking-[-0.01em]` (slight tightening) |
| **Case** | `Haven` (sentence capitalization in running text elsewhere; chrome uses **H + aven** with weight differentiation only) |
| **Color** | Inherited from parent: **`text-foreground`** on workspace / card strips; **`haven-chrome-fg`** (≈ `--chrome-foreground`) on dark chrome rails |

Spacing on the Mercury-style **workspace strip** (AppShell top bar beside facility selector):

- **`pr-4`** (16px) on the brand link immediately before the facility control.

Contrast with **Executive nav v2** top row: legacy “H badge” replaced with same wordmark primitive; inherits `text-foreground` on `bg-card`.

## Future scope

A **distinct logomark** (custom monogram / symbol) may be commissioned later — **not required** today. Until then the wordmark carries the Haven identity in-application.

See also **`docs/design-system/BRAND_PROPAGATION_TODO.md`** for surfaces intentionally unchanged (PDF, OG, email, favicon).
