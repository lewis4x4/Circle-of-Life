# Brand propagation backlog (explicitly out-of-shell scope)

Interactive shells (`AppShell`, `AdminShell`) and **`executive-nav-v2`** wordmark migrated to typography-only (**`HavenShellBrandLink`**) — no circular **H** tile.

Remaining surfaces **not updated** this segment (separate ticket per channel):

| Surface | Notes |
|---------|------|
| **Favicon / app icons** | Still expected to simplify to “H” or future mark; keep browser affordance aligned when mark strategy is finalized. |
| **Open Graph / share images** | Marketing / social previews; coordinate with eventual logomark. |
| **Transactional email** | Any header block using legacy badge/wordmark pairing — audit SendGrid/other templates repo-side. |
| **PDF outputs** | e.g. `src/lib/executive/standup-pdf.ts` uses `.brand-mark` / `mono-mark` **H** — align with typography wordmark policy or deliberate print exception. |
| **Mobile caregiver bottom nav** | No wordmark chrome today — if a persistent “home” strip is added, reuse **`HavenShellBrandLink`** + contract in `FRONTEND-CONTRACT`. |
| **`FamilyShell` / `CaregiverShell`** | No **H** badge before this work; caregiver header emphasizes facility/shift title. Optional future “quiet” Haven label is product call. |

**MedTechShell / DietaryShell:** Chromeless by design — N/A until those surfaces expose global nav branding.
