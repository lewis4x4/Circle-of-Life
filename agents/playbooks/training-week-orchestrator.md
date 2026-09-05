# Training-week closeout — orchestrator

**Role:** One parent agent (this conversation) owns the queue. Planner and coder are children. The parent never implements in the same breath as planning.

## Loop (one item only)

1. **BOOT** — Read this file + `docs/specs/TRAINING-WEEK-CLOSEOUT-QUEUE.md`. Confirm `main` is clean and current.
2. **PLAN** — Parent writes a bounded plan for the **current** queue row only (files, copy, tests, gates, out of scope).
3. **CRITIQUE** — Parent attacks the plan: silent stub? UTC? V2 rewrite surprise? PHI in notes? Scope creep? Revise until the plan is one shippable segment.
4. **IMPLEMENT** — Short-lived branch from `main`. Child coder follows the plan only. No architecture reset.
5. **REVIEW** — Parent diffs against the plan. Fail = send back. No “fix while merging.”
6. **SHIP** — `npm run segment:gates -- --segment "<id>"` (`--ui` if routes/visuals). Conventional commit. Merge to `main`. `git push origin main` (Netlify publishes `main` only).
7. **RECORD** — Mark the queue row done. Next row becomes current. Repeat.

## Hard rules

- One queue row = one branch = one commit = one gate artifact.
- Preserve the **A5** owner attestation dated 2026-08-26. Investigate concrete contradictory evidence through `PHASE1-ENV-CONFIRMATION.md`; do not infer that the agreement is unsigned or invalid without reviewing the contract and current organization settings.
- No personal data in notes.
- Quiet Operator: name gaps; do not invent “Coming soon” pages to hide 404s.
- Standing product: family portal is one-way; Jessica’s rounds times win; snack logs are time + passer only.

## Stop

User says stop, or the queue is empty, or a row needs an owner decision the parent cannot make (record the decision on the queue row and skip to the next unblocked item).
