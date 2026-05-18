# Quiet Operator — Aesthetic Constitution

**Project:** Haven ALF Operations  
**Canonical handoff:** `HANDOFFS/2026-05-16__haven-alf-operations__visual-forge-handoff/design-system/constitution.md`

This file adds **repo-local execution rules** that extend the handoff. For the full manifesto, allowed / disallowed feelings, and rules 1–10, read the handoff copy.

## Chrome vs canvas (rule 11)

**Persistent navigation chrome must not share the canvas background value.** Top bars, side rails, bottom tab strips, and other “frame” surfaces use semantic `--chrome-primary`, `--chrome-secondary`, `--chrome-foreground`, `--chrome-foreground-muted`, and `--chrome-active`. The page canvas stays on `bg-background` (warm paper in forced-light admin/family; near-black when `.dark`).

**Hairline junctions:** Where canvas meets chrome, use **`1px solid` `border-border`** (horizontal under top chrome; vertical between rail and main on wide layouts).

**Theme locks:** Chrome variables are tuned per forced theme — operator light + family (forced-light warm canvas) share the deeper chrome bands; caregiver and admin-dark use slightly **lighter** chrome than light-mode defaults so hierarchy holds over a dark canvas.

**Active rail items:** Background `--chrome-active`, **2px** leading edge `var(--primary)`, text/icons `--chrome-foreground`.
