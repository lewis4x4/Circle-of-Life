# Facility Launch Center — Document Intake UX Review

**Date:** 2026-05-05
**Scope:** `src/app.js`, `src/documentIntelligence.js`, `src/state.js`, `src/intakeCatalog.js`, `styles.css`, `scripts/verify.mjs`
**Mode:** Read-only review. No source files were modified.
**Reviewer:** JARVIS

---

## Context / Scope

The promise the product is making to the user: **upload a document → it auto-identifies what it is → it routes to the right onboarding modules → readiness rescores → the UI clearly explains what was automated vs what still needs a human.**

The PRD/Spec language reinforces every part of that promise:

- *"AI proposes. Humans approve. Deterministic gates decide."* — `Facility_Launch_OS_AI_and_Validation_Spec.md:14`
- *"Every AI-assisted field must show: suggested value, confidence, evidence/source link, why it was suggested, approve/edit/reject controls."* — `…Spec.md:93–99`
- *"AI never hides uncertainty. AI suggestions show confidence and require approval."* — `…UX_Workflows.md:16`
- *"Module readiness is calculated from: Completeness, Currency, Evidence coverage, Confidence, Owner assignment, Sign-off, Contradiction penalty, Exception state."* — `…Spec.md:254–262`
- *"A Homewood pilot user can answer: what is missing, who owns it, which evidence is stale, which duplicate conflicts remain, and whether MVP modules are ready."* — `…PRD.md:291`

This review measures the shipped Document Intake tab against that bar. The implementation today centers on:

- A single-file `<input type="file" id="doc-file-input">` inside a small dashed card (`app.js:439–456`, `styles.css:75`).
- A filename-heuristic classifier `inferDocumentIntelligence(fileName, existing)` (`documentIntelligence.js:69–101`) that returns artifact type, facility, term, dates, currency, confidence, mapped module codes, an `automationSummary` string, and a `documentGroupId`.
- `applyDocumentIntelligenceToForm()` (`app.js:405–432`) which on file pick auto-fills the form fields and writes a one-line preview into `#doc-intelligence-preview`.
- `addDocument()` (`state.js:255–308`) which re-runs the same inference on save, creates the document row, joins/creates a `documentGroups` entry, and stamps the doc with `mappedModuleCodes` + `automationSummary`.

That is the entire intake surface. The rest (table, source-of-truth select, route owner input, exception button) is post-hoc per-row editing.

---

## Findings

### (1) Critical Gaps

These are the gaps where the current build does not deliver the "world-class document intake" the demo is selling. Each one undermines the four-step user expectation directly.

#### G1. The upload affordance is buried, not the hero

The most important action in the entire app is "drop a document and watch it route." Today that action is a `<input type="file" name="file">` rendered inside a `class="grid2 intake-card"` form (`app.js:439–456`). There is **no drop zone, no "Drop or browse" CTA, no progress visualization, no `multiple` attribute, no folder-drop support**. It looks identical to any other tiny file picker. The visual hierarchy says "this is a minor field," not "this is the primary action of this screen."

A user dropping the 30 PDFs in `CIRCLE OF LIFE/` cannot do it here. They have to upload one at a time. That single ergonomic miss kills the "world-class" feeling on the very first interaction.

#### G2. The "what I detected" moment is one terse line — not a confident proposal

After file pick, the only feedback is:

```
Auto-detected: gl_cert · Homewood Lodge ALF · 2022 General Liability · stale · routes to M17
Auto-classified as General Liability; routed to M17; needs refreshed document or exception.
```

That is the wrong format for a "wow" moment. The spec demands a per-field experience with **suggested value, confidence pill, evidence/source link, "why suggested", and approve/edit/reject controls** (`…Spec.md:93–99`). Today every form field is editable plain text with no badge, no "auto-filled" marker, no per-field confidence, no "approve / edit" button. The operator can't tell which fields the system claims vs which fields it gave up on.

#### G3. There is no after-upload feedback loop

`addDocument()` returns silently. The form `reset()`s, the preview line is wiped, and the new row appears at the **top of a table at the bottom of the page**. The summary KPIs do change (`renderSummary` re-runs), but the user is given **no callout** like:

> ✓ Routed `HOMEWOOD GL CERT 2026.pdf` to M17 (Documents) and M16 (Risk). Readiness moved 78 → 82. 1 duplicate group still needs a source-of-truth pick — resolve →

Without that callout, the user does not see steps 3 and 4 of the four-step promise (route + rescore). The entire automation chain becomes invisible at the moment of action.

#### G4. Routing is forward-only and never reflected on the destination

When a doc routes to M16 + M17, those module cards do **not light up**. There is no "+1 evidence" indicator on the Readiness Map card, no chip on the M16 intake panel that says "this evidence is now attached," no module-side affordance like "Open the related GL cert" link. The doc-side `mappedModuleCodes` list is rendered as a tiny `<small>` line inside the document table cell (`app.js:466`); nothing on the module side knows it just received evidence.

In the spec model, evidence count and currency are inputs to module readiness (`scoring.js:312`, `…Spec.md:254–262`). The math runs, but the UI never shows that the upload moved the needle anywhere except in a number on the summary card. No celebration, no traceability.

#### G5. Auto vs Human boundary is never drawn for the operator

The product line is *"AI proposes, humans approve."* The product UI is *"every field is a free text input."* There is no:

- **"Auto-filled"** badge or border treatment on detected fields.
- **Per-field confidence** indicator (the global `confidence` select is collapsed into a single dropdown applied to the whole document).
- **"Approve" / "Edit" / "Reject"** affordance per field.
- **"Why I suggested this"** tooltip referencing the matched filename pattern.
- **Confidence-driven defaults** (e.g., when confidence is `low`, the form should *block save until human review*, per the spec's confidence table at `…Spec.md:85–89`).

The demo viewer can only know what the system did by reading a one-line `automationSummary` after the row is created. That doesn't satisfy *"AI never hides uncertainty"* — it satisfies *"AI mumbles."*

#### G6. The reverse view ("what's missing") is absent

The PRD's success criterion is that the operator can answer *"what is missing"* (`…PRD.md:291`). Today the doc tab shows the documents that **exist** but never shows the documents the modules **expect and don't have**. There is no "Documents needed for launch" panel listing, e.g., for Homewood:

> M2 needs a current state license — none uploaded yet.
> M17 needs a 2026 property cert — only 2022 variants present, both stale.
> M17 needs a current GL cert — duplicates unresolved.

This is a missing first-class affordance. Without it, the operator sees what's been done, not what they still need to do.

#### G7. No simulated content extraction — the demo flatlines after the filename trick

`documentIntelligence.js` is filename-only (correctly noted in the doc tab lead text). That's fine as a static-app constraint — but the demo never *shows* what content extraction would feel like. The seeded `HOMEWOOD GL CERT.pdf`, `OAKRIDGE PROPERTY CERT.pdf`, etc., have known content (named insured, policy number, effective/expiration dates, limits). The demo could simulate "extracted fields" for those known files (a hardcoded fixture keyed by filename), drop them onto the form as suggestions with a HIGH confidence pill, and **show what production OCR will look like**. Without this, the demo's first impression is "you made the file picker auto-fill from the name" — which is small. The real promise is OCR, and we're not even faking it.

#### G8. Source-of-truth resolution is buried below the fold

Duplicate-group resolution is the most consequential decision a custodian makes during intake (it directly gates Gate 2). Today it lives at the bottom of the doc tab as a row of cards under an `<h3>Duplicate / Variant Groups</h3>`. There is no:

- Top-of-page callout: *"⚠ 2 duplicate groups still need a source-of-truth pick"*.
- Highlight on the affected document rows ("part of unresolved group: GL cert").
- Inline-with-document affordance (e.g., a "Make this the source of truth" button on the row itself).

A Gate 2 reviewer scanning this page will not notice the duplicate state from the top of the screen.

#### G9. Stale-document routing is too thin

The stale-routing affordance is a single `<input data-route-doc>` placeholder text "Route owner" + a "Request Exception" button (`app.js:474`). Problems:

- No predictive default — could pre-fill from `program.documentCustodian` (which exists in seed state).
- No picker of likely candidates (Document Custodian, ED, CFO, Legal).
- No "Replace this file with a current one" affordance — the natural human reaction to "stale 2022 doc" is "let me upload the 2026 version." That's not surfaced here.
- The "Request Exception" button creates an exception with a templated description but never tells the user where the new exception lives or who must approve it.

#### G10. No undo, no delete, no replace

There is no delete button on a document row. M3 rooms, M4 employees, and every operational intake collection have inline delete buttons (`app.js:319, 309, 313`). Documents do not. A misclassified upload is permanent unless the user "Reset Demo." That's a parity bug in addition to a missing feature.

#### G11. The confidence model is decorative, not enforced

`CONFIDENCE_LEVELS` is a free dropdown on every document. Confidence does not gate anything in the UI:

- A `low` confidence document still saves freely.
- A `low` confidence document still routes to its modules silently.
- A `high` confidence detection still defaults the *form's* confidence select to `manual` until a file is picked (see `app.js:451`, the `<select name="confidence">` initial selected value is `"manual"`). On save, `addDocument` writes whatever the form contains — so if the user types over and the form's still showing manual, manual wins. The intelligence preview overrides this on file-pick, but the initial paint is wrong.

The spec's confidence-state table — *"Low: do not use for sign-off without review"* — is not enforced by any code path. Currency is not enforced either: stale documents still count toward `evidenceCount` in the module rollup. There is no "approval gate" between upload and "evidence counted toward readiness."

#### G12. The verifier does not test any UX-critical claim

`scripts/verify.mjs` exercises the data layer thoroughly (g0/g1 prove auto-classification works programmatically). It does **not** test:

- That the operator sees a "what was detected" surface after pick.
- That readiness moves visibly after upload.
- That the duplicate-group resolution is reachable from the top of the page.
- That a `low` confidence document is gated.
- That replace/delete flows exist.

So the green test suite does not protect any of the experience claims this review is targeting. That's worth noting because the team will read green tests as "shipped."

---

### (2) Must-Fix-Before-Demo

These are the items that, if not addressed, will visibly fail the "world-class intake" pitch within the first 60 seconds of a demo. Ordered by impact, not effort.

| # | Fix | Why it matters in demo | Approx. effort |
|---|-----|----------------------|----------------|
| **MF1** | **Promote the file picker to a hero drop zone.** Big card spanning the form width, dashed border, "Drop a document or **browse**" CTA, accept multiple files, show file name + spinner per file. | First impression. Today the hero of the doc tab is a paragraph; the picker is a sidekick input. | ~2 hrs |
| **MF2** | **Replace the one-line preview with a "Detected facts" card.** After pick, render a panel with: artifact-type pill, confidence pill (HIGH/MEDIUM/LOW with color), facility, term, effective→expiration date pair, "Routes to: M16, M17" chip row, "Why: matched filename pattern `/gl|general\s+liability/`" caption, and **"Confirm and save" / "Edit details"** primary actions. The confirm-and-save is one click. | This is the "AI proposes, human approves" moment the spec promises. Today it's a sentence; it should be the panel. | ~3 hrs |
| **MF3** | **Post-save "what just happened" callout.** A toast/banner above the table: *"Routed `<file>` to M17, M16. Facility readiness 78 → 82. 1 duplicate still unresolved → Resolve."* Auto-dismiss after 8s; persist last-callout in memory so the demo presenter can re-show it. | This is the rescore moment. Without it, the four-step promise has no step 3 or 4 visible. | ~2 hrs |
| **MF4** | **"Documents launch needs" panel** at the top of the doc tab. List artifact types each in-scope module expects, with status: ✓ have a current source-of-truth / ⚠ have stale-only / ✗ none yet. Drop targets per row. | This is the "what is missing" answer the PRD demands. Today the page only shows what exists. | ~3 hrs |
| **MF5** | **Per-field auto-fill markers.** When `applyDocumentIntelligenceToForm` writes a field, add `data-auto="true"` and visually mark it (left border accent, "auto" badge). On user typing, drop the marker and demote `confidence` to `manual`. | "AI never hides uncertainty" — the operator must see, at a glance, which fields are AI-claimed vs human-typed. | ~2 hrs |
| **MF6** | **Lift duplicate-group resolution to the top.** Banner: *"⚠ 2 duplicate groups need a source-of-truth pick"* with an inline picker right there. Highlight affected document rows in the table. | Gate 2 blocker is hidden today. A demo audience scanning the page top-down will not see it. | ~1 hr |
| **MF7** | **Add a per-row delete button on documents.** Parity with every other intake collection. | A misclassified upload is permanent today. Demos always misclassify at least once. | ~30 min |
| **MF8** | **Fix the form-default confidence drift.** When no file is picked, the initial `confidence` should be empty/placeholder (not `manual`). When a file is picked, confidence reflects the detector's value. When the user edits any auto-filled field, confidence demotes. | Today the static initial state contradicts the auto-detect output. | ~30 min |
| **MF9** | **Simulated content extraction for the seeded files.** A small fixture keyed by filename returns extracted facts (named insured, policy number, effective/expiration, limits) for the well-known Homewood/Oakridge/Rising Oaks/Grand Cypress PDFs in the parent directory. The "Detected facts" card from MF2 picks these up so the demo shows what production OCR feels like. | The biggest perception gap: today the demo only auto-fills from the *filename*. The real product reads contents. The static demo can fake this for 6–8 known fixtures and the message lands. | ~3 hrs (fixture + wiring) |
| **MF10** | **Stale-doc "Replace with a current copy" affordance.** On any stale row, show a small "Upload current version" button that opens the same picker pre-filled with the artifact type and facility, and on save links the new doc to the same `documentGroupId` and selects it as source-of-truth. | The natural human reaction to "stale 2022 doc" is "let me grab the 2026 one." Production needs this. The demo gets a strong moment from it. | ~2 hrs |

Total surface for MF1–MF10: roughly **two engineer-days** of careful work, no new dependencies, all within the static-app posture.

---

### (3) Acceptable Static-App Limitations

These I would *not* try to fix before the demo. Each is honest and defensible if the lead text and tooltips are tuned correctly (see Section 4).

- **L1. Filename-only classification.** No real OCR, no parser, no PDF.js. The current lead text *does* call this out (`app.js:438`: "production OCR/AI extraction should read document contents…"). Keep the disclosure; sharpen the wording (Section 4).
- **L2. LocalStorage persistence only.** Multi-user, audit log durability, custodian sign-off chains all live in production. Acceptable for a static MVP; the README and `PRODUCTION_HANDOFF.md` already cover it.
- **L3. Single facility ("Homewood Lodge ALF").** The intake correctly defaults to Homewood; multi-facility detection in `documentIntelligence.js:14–20` exists for filenames mentioning Oakridge/Rising Oaks/etc., but the rest of the app (modules, gates, exports) is single-facility. Don't try to expand this for the demo.
- **L4. No real upload/network.** Files are not actually transmitted; only filename and metadata are kept. Acceptable. The hero drop zone (MF1) should be honest about this in micro-copy: *"Filename-only ingest in this preview build — production parses contents on upload."*
- **L5. No e-signatures, no DocuSign-style provenance.** Custodian "approval" is a select. Acceptable for MVP/demo.
- **L6. No virus/file-type scanning.** Acceptable. The form doesn't even need an `accept=".pdf,.png,…"` attribute for the demo — it should still be added for politeness (Section 4).
- **L7. No real "extraction confidence per field."** Production OCR returns per-field confidence; the static demo can derive a single document-level confidence from the matched rule + presence of a year (which `confidenceFor` already does). That single-confidence model is acceptable as long as MF5 marks which fields were auto-filled.
- **L8. No real "evidence/source link."** The spec calls for a clickable link back to the document for every AI-suggested field (`…Spec.md:93–99`). In the static demo, the document title in the row can serve as that link target — acceptable, do not build PDF region highlighting.
- **L9. No machine-learned classifier.** The rule-based classifier is fine for the demo. The UX can speak about *"rule-based detection in this preview; AI classifier in production"* and that's honest.

---

### (4) Recommended Wording / UX Improvements

These are surgical copy and micro-UX changes — not feature work — that immediately raise the perceived polish of the doc tab. None of these require code architecture changes.

#### Lead text (`app.js:437–438`)

**Today:**

> Upload a document and the launch center will auto-classify the likely document type, facility/entity, term, date currency, duplicate group, and mapped module route. This static version uses filename/document metadata heuristics; production OCR/AI extraction should read document contents and push confirmed facts into modules automatically.

**Replace with:**

> **Drop a document. The launch center identifies what it is, attaches it to the right modules, flags duplicates and stale terms, and rescores facility readiness on the spot.**
>
> This preview classifies from the filename; the production build reads the document's contents (license number, named insured, expiration date, policy limits) and routes those facts into the modules automatically. AI proposes — you approve everything before it counts toward Gate 2.

This reframes the page from "here's a form" to "here's an automation," and sets the expectation that a human will approve. It also mirrors the spec's governing rule ("AI proposes, humans approve") in the user's own language.

#### Drop zone microcopy (for MF1)

- Empty state: **"Drop a document, or browse."** Sub-line: *"PDF, JPG, or PNG. License, GL certificate, property policy, bond, loss run, floor plan, vendor agreement — I'll figure out which."*
- Detected: **"Detected: 2022 General Liability — Homewood Lodge ALF · stale (expired 2023-01-01)"** with a *"Looks right — save"* primary button.
- Couldn't detect: **"I couldn't classify this from the filename. Pick the document type below and I'll route it."** with a fallback `<select>`.

#### "Detected facts" card copy (for MF2)

Use chips, not a sentence:

```
[gl_cert]   [Homewood Lodge ALF]   [2022]   [STALE — expired 2023-01-01]
                                                  [HIGH confidence]
                                                  Routes to: [M17 Documents] [M16 Risk]
Why: filename matched "/general\s+liability|gl/" and "/2022/"
                                                  [Confirm and save] [Edit details]
```

The *Why* line is the spec-mandated "evidence / why it was suggested" surface. It is one line of copy and removes a giant trust gap.

#### Per-field "auto-filled" treatment

When `applyDocumentIntelligenceToForm` writes a field, add `data-auto="true"` and a CSS rule:

```css
[data-auto="true"] { border-left: 3px solid #2a4bff; background: #f4f7ff; }
[data-auto="true"]::after { content: "auto"; ... }   /* small pill */
```

On `input`/`change` of that field by the user, JS removes `data-auto` and sets the document's `confidence` to `manual`. This is where MF5 and MF8 land in copy form.

#### Document table column microcopy

**Column "Document" (`app.js:464–465`):**
- Today: filename + "Source of truth | variant/intake" + "Routes:" + automationSummary, all jammed together as `<small>` lines.
- Better: title in bold, then **a single chip row**: `[gl_cert] [Homewood Lodge ALF] [stale] [→ M17, M16]`. Move `automationSummary` into a tooltip on a small "i" icon. The default cell becomes scannable.

**Column "Route/Exception" (`app.js:474`):**
- Today: `<input placeholder="Route owner">` + "Request Exception".
- Better, when stale: `[Replace with current copy] [Route to: <select prefilled with Document Custodian>] [Request exception →]`. Three explicit actions, ordered by what the operator most likely wants to do.

#### Empty state for the table

Today: missing entirely (silent empty `<tbody>`). Add:

> *"No documents yet. Drop your first license, GL certificate, or property policy above. I'll classify it and tell you which modules it's filling."*

#### Reset Demo button

The Reset button at the bottom of the page is unlabeled outside the words "Reset Demo." Add `title="Wipes localStorage and reloads the seed Homewood fixture"` so demo presenters know exactly what it does mid-call.

#### Confidence pill copy

When you render the confidence chip:

- **HIGH** — *"Auto-classified with a strong match. Defaults to approved evidence."*
- **MEDIUM** — *"Auto-classified; please confirm the document type and term before signing Gate 2."*
- **LOW** — *"Couldn't classify confidently. This document won't count toward readiness until you approve it."*

These are tooltips, not body text. They make the confidence value carry weight instead of feeling decorative.

#### Mapped-modules chip

Replace `Routes: M17` text (`app.js:466`) with chips that link to the module on click:

```
Routes to → [M17 Documents] [M16 Risk]
```

Clicking should switch `activeTab` to `modules` and scroll to the matching `<details>` block. The infrastructure is already there (`renderModules`, `<details id="…">` markup; you just need anchors and a scrollIntoView call).

#### Source-of-truth picker copy

In the duplicate-groups card (`app.js:478`):

- Today: *"Select source of truth"* + *"Only documents in this group are accepted."*
- Better: *"This group has 2 candidate copies — pick the one that should count for Gate 2. The others stay attached as variants."* Plus a "Why these two are a group: same artifact type + facility + year" caption.

#### Approval verb

`custodianApprovalStatus` is a select with values `pending / approved / rejected / needs_review`. Pair the select with verbs:

- **Approve** (sets approved + records who approved when, in the decision log).
- **Send back to custodian** (sets needs_review).
- **Reject** (sets rejected + requires a note).

Right now the user picks an enum value silently. The verb form is the spec's *"approve / edit / reject"* control surface in `…Spec.md:93–99` — the single highest-leverage piece of language polish on the page.

---

## Summary

The shipped Document Intake makes all four steps of the world-class promise mechanically work: upload classifies, routes, rescores, and exports. The data plane is solid (the verify suite proves it). What it doesn't yet do is **show the user that any of that happened.**

- The hero of the page is a paragraph, not the upload.
- The detection result is a sentence, not a panel.
- The rescore is a number that quietly changes in the corner, not a callout.
- The "AI proposes, human approves" boundary lives in the spec, not in the UI.
- The "what's missing" question — the entire reason this product exists — has no answer surfaced in the doc tab.

Two engineer-days of work on **MF1–MF10**, paired with the wording changes in Section 4, would close the gap between what the spec promises and what a viewer feels when they drop their first PDF. The static-app constraints in Section 3 are easy to defend if the copy in Section 4 is tightened — and the perception gap collapses entirely if MF9 (simulated content extraction for the seeded ALF documents) ships.

The single most valuable demo-day fix, if only one is taken: **MF2 — replace the one-line preview with a real "Detected facts" card with confirm/edit affordances and per-field auto-filled markers.** That single change reframes the entire page from *"a form with autofill"* into *"an automation you approve."* Everything else compounds from there.
