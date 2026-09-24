# Document Intake Decision: Haven and Cornerstone

Decided 2026-09-24 by Brian Lewis after a seven-voice agent panel (single-inbox advocate, purpose-address advocate, request-driven advocate, compliance red team, implementation architect, final skeptic, orchestrator). Revised the same day: the catch-all is the center of the design and must take every kind of document from every kind of sender. Final review the same day corrected three details: no forwarding hop in front of the receiver, Jev gated by sender type, and rollout gated by register readiness. **Applies to every module in both platforms.**

## Decision

One intake address per company catches every document anyone has to send in: facilities, subcontractors, insurance agents, homeowners, vendors, employees, families. Any format (email, scan-to-email from a copier, phone photo). Senders never pick an address or a category.

The system does not guess blindly across every document type. It knows who sent the file and what that sender currently owes, so the question becomes "which of this sender's open obligations does this satisfy?" — a short-list pick, not a 50-way guess. Anything that does not match lands in a human triage queue. Nothing is dropped.

Not 40 to 50 mailboxes. Not one AI brain guessing across everything.

## The Obligations Register

A catalog of every document any party must send. One row per document type:

| Field | Meaning |
|---|---|
| `doc_type_code` | e.g. `sub_coi`, `borrower_hoi_dec`, `borrower_tax_receipt`, `facility_deposit_slip`, `resident_1823` |
| `owed_by` | party type: facility, subcontractor, insurance_agent, borrower, vendor, employee, resident_family |
| `trigger` | how an obligation opens: expiration date on file, annual date, per event (admission, new job), recurring (daily, monthly) |
| `lands_in` | module table the document files into |
| `extract_fields` | fields the reader must return for this type |
| `checks` | code rules (expiry after today, limits meet the trade's coverage matrix, amount equals keyed amount) |
| `jev_questions` | versioned yes/no question set for this type |
| `reviewer_role` | who confirms |
| `consequence` | what happens when overdue (pay-app hold, force-place notice, administrator scorecard) |

Each row generates open obligations per party. Adding document type #51 is one catalog row, not a new address and usually not new code.

The register is the union of requirement tables the modules already have, plus rows for flows with no table yet. Implement as an `open_obligations` view per platform over those tables. **Do not create a parallel requirements store.**

- **Haven:** `admission_document_checklist_items`, `employee_file_requirements` (due_days, recurrence_months), `staff_certification_requirements`, `document_acknowledgment_requirements`, and the Medicaid case requirements (`benefits_requirements`, Module 39).
- **Cornerstone:** `coverage_matrices`, `owned_note_monitor_items` (reported_due_on, reported_expiry_on), step 1 policy-term history.

Illustrative catalog (the full list is Brian's input): facility → Home Office (resident payment scans and daily deposit slips, admission packet, AHCA Form 1823, care plan updates, incident and inspection reports, license and permit renewals, staff certifications, vendor invoices); subcontractor (COI, W-9, license, lien waivers, pay applications); insurance agent (COIs and endorsements for subs); homeowner/borrower (homeowners insurance dec page, property tax receipt); vendor (COI, W-9, invoices); employee (certifications, training records).

## What happens to every file

1. **Store first.** Raw `.eml` and sha256 saved before any processing. Each attachment (and each document inside a multi-document scan) becomes its own envelope row.
2. **Who sent it.** Sender identity is trusted only when authenticated at the first hop (SPF, DKIM, DMARC results from the receiving mail system, or an internal sender inside the tenant). Sender address maps to a party (Cornerstone `people.email`, `party_aliases`; Haven staff, vendor and contact records; each facility copier and mailbox maps to its facility; an insurance agent maps to every sub it insures). Tokens in the address or subject bind straight to one record. Unauthenticated senders are unknown.
3. **What do they owe.** Pull that party's open obligations.
4. **Read it.** The reader turns the PDF or image into text and the fields for the candidate doc types.
5. **Which one is this.** Jev (only where the sender-type rule allows) or the reader picks the matching obligation from that short list, or "none of these". Jev runs the doc type's yes/no checks. Code runs every date and dollar check.
6. **File it.** Proposed filing on the record, a person confirms. Low-risk types go automatic only after measured thresholds. **Never automatic for resident documents or payments.**
7. **No match or unknown sender.** The reader (never Jev) classifies against the whole catalog, shows the top three guesses, and sends it to the triage queue. The triage pick becomes the sender mapping and training data.
8. **Tell the sender.** Acknowledge what was received and what is still owed. A failed check becomes a correction request. No auto-reply to unknown or unauthenticated senders.

## Accelerators (optional, not required channels)

- **Requests.** When an obligation opens, email the party what is owed with a one-record upload link and a tokenized reply address; remind at 30, 14, 7, 0 days where a due date exists; escalate to a named owner with the catalog's consequence. Replies arrive at the same intake and bind by token.
- **In-app capture.** Where staff are already in Haven (checks at the front desk), capturing inside the app ties the scan to the record at the moment of entry.

## AI roles

- **Reader:** Sol in Cornerstone, or Claude. Reads the PDF or image; returns text plus the fields for the candidate doc types. Jev cannot do this step.
- **Decider: Jev (TypeSafe).** Choice among the sender's open obligations plus "none of these"; yes/no checks from `jev_questions`; deficiency severity score for triage order; whether the email body needs a human reply. Store probabilities, `questions_version` and model with every answer (Haven's `compliance_doc_triage` already has this shape).
- **Sender-type rule for Jev (decided before any AI runs):**
  - Cornerstone: allowed for all authenticated senders (no PHI in GSMS flows).
  - **Haven: allowed only when the authenticated sender's entire open-obligation set is `phi = false`** (vendors, insurance agents, lenders). Facility senders, employees, families and all unknown senders are read and decided by Claude only. The PHI decision never depends on what an AI predicted the document to be.
- **Code:** every date, limit and amount comparison. Jev never decides whether something is expired, adequate or correctly priced.
- **Gate:** auto-propose only when the top choice leads the runner-up by the measured margin and all checks clear. Reader and Jev disagreeing sends it to review. Thresholds come from shadow data, not defaults.
- **Adversarial text:** compare the PDF text layer against OCR of the page image; any gap goes to review. No model has write access to anything.
- **Keep or drop Jev:** only if shadow data shows it catches errors the reader misses.

## Plumbing

- **Receive where the public address actually lands. No forwarding hop in front of the receiver** (a forward rewrites the envelope, can break DKIM, turns SPF into a check of the forwarder; Exchange Online blocks external auto-forwarding by default).
- **COL receiver:** `docs@circleoflifecommunities.com`, a real Exchange Online shared mailbox behind Proofpoint and EOP, read with Microsoft Graph. A delta-query sweep every few minutes is the source of truth; change notifications only accelerate (subscriptions expire in under 7 days). App registration with `Mail.Read` scoped to that one mailbox (Exchange RBAC for Applications). Take the Authentication-Results Exchange stamped at the first hop. Requires full admin control of the tenant (defederate from GoDaddy or confirm the admin path GoDaddy allows).
- **GSMS receiver:** decided once we know where `gsmsdevelopers.com` mail lands. M365 → same adapter as COL. Otherwise AWS SES or Cloudflare Email Routing on a subdomain whose address is published directly (e.g. `docs@in.gsmsdevelopers.com`), never behind a forward.
- **Adapter contract:** each receiver is a thin adapter whose only output is the raw `.eml` stored with its sha256 plus the first-hop authentication results. Everything after that is shared logic.
- **Duplicates:** superseded by policy term or record, not only by identical bytes.
- **Accept:** PDF, JPEG, PNG, TIFF, HEIC, checked by content. Reject encrypted files, open zips one level only, never auto-fetch links.
- **Sending:** SPF, DKIM and DMARC on both domains before the first request or acknowledgment goes out.
- **No shared cross-repo package yet.** Build the engine in Cornerstone on its existing tables (`document_admissions` is the envelope; add `purpose_key`, `obligation_id`, `token_id`, auth results). **Haven copies the proven pattern.**

## Rollout gated by register readiness

An address is announced to a party type only once that party type's register rows are seeded and its open obligations are populated. Order:

1. GSMS subcontractors and their insurance agents (COIs).
2. GSMS borrowers (homeowners insurance, property tax).
3. COL vendors and insurance (non-PHI).
4. COL facilities (payments, resident paperwork).

## UI (three tiers)

1. **Owed board:** parties with overdue or due-soon obligations, plus the triage count. Nothing else.
2. A party's open obligations with status and the latest document for each.
3. Full document history, envelopes, Jev answers, audit trail.

## Cornerstone

The existing COI build order stands, with these changes: step 1 includes the Cornerstone register rows and the `open_obligations` view; steps 2 (intake packages, mailbox processing, durable jobs, exception ownership) and 4 (reminder, reply, correction loop) are obligation-driven and purpose-agnostic, not COI-specific, and the receiver follows the no-forwarding-hop rule; step 3 follows the AI roles above; the completion journey adds the time-to-find test. First obligations: subcontractor COI (opens 30 days before expiration on file; consequence: pay-application hold through `approval_requests`); borrower homeowners insurance (opens 30 days before expiration; counsel confirms whether Reg X force-placed insurance rules, 12 CFR 1024.37, apply before any force-place notice); borrower property tax proof (check the county tax collector first; open only when unpaid after March 31).

## Haven

Nothing here touches the COL-677 floor tablet and kiosk build or the Oct 1 Homewood go-live. **Haven intake starts after Homewood settles.**

- **Checks at the front desk:** Receive payment screen (resident, amount, method, check or money order number, photo front and back). End of day, Close deposit lists the items and staff photograph the deposit slip; totals must match. A facility that scans checks and the slip to the intake address lands against its open daily deposit obligation. No AI on check images in v1 (MICR line carries bank account numbers).
- **ACH and online payments:** not a document flow; evidence comes from bank or processor data.
- **Everything else facilities send:** scan or email to `docs@circleoflifecommunities.com`; matched against that facility's open obligations. Each facility copier sends as its own authenticated address.
- **Resident trust funds** (Fla. Stat. 429.27) are their own catalog rows, separate from fee payments.

## Triage ownership

One Home Office admin per company owns the triage queue, each with a named backup and an SLA timer on every item. Alert when an expected source goes quiet (for example, no Homewood deposit in 3 days).

## Acceptance test (gate out of shadow mode)

The Cortex test: every filed document opens from its record in two clicks, and median time to find a document beats filing it by hand. Measured in shadow mode before any automation is switched on.

## Superseded

- COL-771's per-facility AgentMail inboxes and forwarded-letter receiver (PR #893, closed unmerged 2026-09-24; migration 520 removed from staging and production the same day).

## Still needed

- The Obligations Register content: every document type any party must send, with who owes it, what triggers it, where it lands and the consequence.
- Names of the two Home Office triage owners and their backups.
- Where `gsmsdevelopers.com` mail is hosted and who controls its DNS.
