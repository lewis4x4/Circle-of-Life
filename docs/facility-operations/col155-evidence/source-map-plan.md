# COL-155 source mapping plan

Status: source inspection and proposed contract only; no adapter activation, application edits, hosted calls, or clinical acceptance claimed.

Exact saved contract: **36 source items / 41 catalog components**. Canonical source is `src/lib/operations/activity-catalog.json`; component UUIDs and kinds below are copied without reinterpretation. Catalog draft mappings are not approved rules.

## Shared review predicate and authority

Each selected source must match organization, facility and catalog subject, and be readable through its native current-actor authorization as well as operations access. Resident authorization must not be widened by facility-summary access. A source reference carries family, record ID, immutable version or content fingerprint, relevant native event date, and the explicitly chosen review period. Mutable sources require a version/fingerprint comparison at recording and later currentness checks. A missing, inaccessible, changed, voided or superseded source produces unavailable/needs-review with retained historical reference; it must not silently remain current or be replaced by the latest row.

Administrative review finality is an explicit human review receipt with actual reviewer/time/findings, governed by the existing requirement and evidence rules. Native source existence never completes that review. Native-action components keep their catalog kind: a review cannot assert an observation, order completion, provider contact, payment, arrival, signature, printing or delivery occurred. Source families listed as candidates are code-discovered read surfaces, not implemented HFO adapters or approved clinical finality predicates.

Manual fallback: retain the existing manual receipt/evidence workflow when the published requirement permits it, using explicit source/version, period, findings and missing-evidence status. Unknown subject, applicability, authority or unapproved rule remains unavailable; manual fallback does not bypass these gates. Never use the automatic native-performance delivery mechanism from migration358 to satisfy a human record-review from mere clinical record presence.

## Exact component inventory

| Source / cell | Component key / UUID / label | Canonical kind / subject | Reader family and finality boundary |
|---|---|---|---|
| AL-D02 / Daily A3 | `hfo-al-d02-01` / `73a5af51-9f79-43cc-b7be-91ebe77b565e` / Update referral log | linked_domain_action / facility | Referral / maintenance native workflows; separate component references. No resident reader substitution. |
| AL-D02 / Daily A3 | `hfo-al-d02-02` / `d5fca692-4d4d-48bb-b298-72726907b985` / Update maintenance log | linked_domain_action / facility | Referral / maintenance native workflows; separate component references. No resident reader substitution. |
| AL-D05 / Daily A6 | `hfo-al-d05-01` / `2b1b061a-b738-4198-87b3-e713971c82f6` / Observe hygiene, health and psychological status | structured_observation / resident | Observation: daily_logs, adl_logs, behavioral_logs, condition_changes; performed observation remains native work. |
| AL-D06 / Daily A7 | `hfo-al-d06-01` / `19e78f26-5b81-4fff-a800-164d4aae1be1` / Record hygiene concern and follow-up | linked_domain_action / resident | Hygiene concern / native follow-up: adl_logs and condition_changes as context; presence does not prove resolution. |
| AL-D07 / Daily A8 | `hfo-al-d07-01` / `831e44c4-1cbb-4331-8179-2f165d70b7b4` / Review observation logs | record_review / resident | Observation logs: daily_logs / adl_logs / behavioral_logs / condition_changes; explicit administrative review. |
| AL-D08 / Daily A9 | `hfo-al-d08-01` / `a0624feb-471a-477a-8efd-cc9404a728d2` / Review Med Pass for issues | record_review / resident | External med-pass evidence; approved external reader/export unresolved. Never create dose attestation. |
| AL-D09 / Daily A10 | `hfo-al-d09-01` / `2a75d885-0262-47a2-af07-351a5a2cabce` / Review refused Med list | record_review / resident | External medication refusal review; second component native resident/provider follow-up. No inferred contact or resolution. |
| AL-D09 / Daily A10 | `hfo-al-d09-02` / `0e710315-274e-4242-bd2d-4d85f54a4feb` / Follow up with resident and doctor | linked_domain_action / resident | External medication refusal review; second component native resident/provider follow-up. No inferred contact or resolution. |
| AL-D10 / Daily A11 | `hfo-al-d10-01` / `b740b36a-26d7-4957-a6c1-326189f12478` / Review daily shift report | record_review / facility | Shift-report source/version unresolved; facility review, not a resident log renamed as a shift report. |
| AL-D12 / Daily A13 | `hfo-al-d12-01` / `65c70899-f5ef-452d-9c5b-2a95305b8d3b` / Review Residents Temp & 02 Log | record_review / resident | daily_logs vitals are candidate context only; Q11 meaning of 02 and exact log unresolved. |
| AL-D14 / Daily A15 | `hfo-al-d14-01` / `994566c9-e0ad-4b0d-b4d9-f56d2a490955` / Review DNR currency | record_review / resident | advance_directive_documents candidate context; operator verified status is not authenticated provider signature. Binder component requires physical verification. |
| AL-D14 / Daily A15 | `hfo-al-d14-02` / `2356eef8-00cc-476d-bc7a-7cd567f0e7ff` / Verify DNR in resident binder | attestation / resident | advance_directive_documents candidate context; operator verified status is not authenticated provider signature. Binder component requires physical verification. |
| AL-D18 / Daily A19 | `hfo-al-d18-01` / `244ba5e8-3dea-4366-a69a-f0774cf77b21` / Follow up on orders and record completion | linked_domain_action / resident | verbal_orders / other native order families require separately verified order-type predicates; completion and provider signature are distinct. |
| AL-D19 / Daily A20 | `hfo-al-d19-01` / `914b1dba-087a-44d7-abbf-49eebc9a13bb` / Update admission and discharge log | linked_domain_action / facility | Admission/discharge event workflow; facility reconciliation must retain actual-arrival gate; case creation is insufficient. |
| AL-W05 / Weekly F1 | `hfo-al-w05-01` / `84345246-df3a-4b57-a623-a722697279f1` / Audit order completion | record_review / resident | Native order population and version; administrative completion audit, not native execution. |
| AL-W07 / Weekly I1 | `hfo-al-w07-01` / `711e594b-0ab1-4ce3-9081-e7c20837c589` / Review resident emergency packet completeness | record_review / resident | Resident documents/contacts candidate context; packet checklist and physical-copy verification remain manual. |
| AL-W08 / Weekly J1 | `hfo-al-w08-01` / `bcaf8a16-f059-4a90-b2ad-6f2b678b87f1` / Record DCF admission or discharge notice | linked_domain_action / resident | Admission/discharge event context plus external notice evidence; event does not prove notice sent/delivered. |
| AL-M02 / Monthly C1 | `hfo-al-m02-01` / `8a758954-1685-420d-a8f6-36b496c7d36b` / Record resident weight | structured_observation / resident | daily_logs weight reading in native vitals workflow; native structured observation, not administrative review performance. |
| AL-M03 / Monthly D1 | `hfo-al-m03-01` / `18b0be97-d5b7-4665-8b43-6a154dbe1c49` / Review 1823 accuracy | record_review / resident | form_1823_records plus received evidence; administrative accuracy review remains separate from receipt/currentness. |
| AL-M04 / Monthly E1 | `hfo-al-m04-01` / `1b8513a1-3a40-47c1-b6bf-06abb9a53537` / Review bed rail order currency | record_review / resident | Native bed-rail order/assessment/consent family not yet established; manual version-bearing review; no generic verbal-order equivalence. |
| AL-A01 / Audits - Monthly B1 | `hfo-al-a01-01` / `2116af81-ce6e-4df3-b0b1-2adb558795a8` / Audit med carts | record_review / asset | Asset med-cart audit; no resident clinical adapter substitution; physical audit findings/manual receipt. |
| AL-A02 / Audits - Monthly C1 | `hfo-al-a02-01` / `dc21bac1-bccd-4142-b990-bdd16770055d` / MORS | record_review / Unknown | No reader: MORS meaning and subject unknown (Q11). Preserve blocked mapping, never infer medication source. |
| AL-A03 / Audits - Monthly D1 | `hfo-al-a03-01` / `6bf100b5-1aaa-45bc-8d5d-e93d5b2dc2a6` / Audit 1823 binder | record_review / resident | form_1823_records candidate document context; binder completeness/physical presence requires manual review. |
| AL-A04 / Audits - Monthly E1 | `hfo-al-a04-01` / `800a41ef-a0bd-43ed-8215-187f5016a974` / Audit observation logs | record_review / resident | Observation logs candidate population; administrative audit distinct from each observation. |
| AL-A05 / Audits - Monthly F1 | `hfo-al-a05-01` / `a68a32dd-f8e2-48b5-a2e2-7d515d6474ee` / Audit resident files | record_review / resident | Resident document family for files; daily_logs weight for second component. Independent coverage/findings. |
| AL-A05 / Audits - Monthly F1 | `hfo-al-a05-02` / `381c985b-4229-4227-b25e-958be0cce264` / Audit weights log | record_review / resident | Resident document family for files; daily_logs weight for second component. Independent coverage/findings. |
| AL-A06 / Audits - Monthly G1 | `hfo-al-a06-01` / `a8f82af9-9c86-41d4-806c-cb4571d3d780` / Audit accurate order completion | record_review / resident | Native order family candidate context; accuracy audit and execution are separate. |
| AL-A09 / Audits - Monthly J1 | `hfo-al-a09-01` / `0a0e0dc9-1178-4078-88da-8581f577b5b4` / Audit admission and discharge log | record_review / facility | Admission/discharge event population reconciliation; facility subject and explicit period. |
| AL-N01 / New Admission B1 | `hfo-al-n01-01` / `a2d7ff2c-9c9f-4f09-aef9-95c1a0a68ba9` / Record signed admission contract | event_checklist / resident | Executed contract / signing family requires verified current document and required signers; SignedDoc metadata alone insufficient. |
| AL-N02 / New Admission C1 | `hfo-al-n02-01` / `7f436d7c-2cf4-406b-9e17-0ef3568a895c` / Record admission 1823 completion | event_checklist / resident | form_1823_records received/current evidence; no provider signature inference from received status. |
| AL-N03 / New Admission D1 | `hfo-al-n03-01` / `c2b071d6-bd5e-486e-a299-ed037c0b4b8d` / Review admission DNR applicability and document | event_checklist / resident | advance_directive_documents candidate context; explicit applicability/current signed-order verification, not operator status alone. |
| AL-N04 / New Admission E1 | `hfo-al-n04-01` / `0ba1f10d-d779-4f8e-8e38-e7807987856f` / Verify admission contact information | event_checklist / resident | resident_contacts candidate context; authority/completeness manual. Printed face-sheet is independent manual handoff. |
| AL-N04 / New Admission E1 | `hfo-al-n04-02` / `5b54fde6-0f27-4976-a313-80473864555e` / Print admission face sheet | event_checklist / resident | resident_contacts candidate context; authority/completeness manual. Printed face-sheet is independent manual handoff. |
| AL-N05 / New Admission F1 | `hfo-al-n05-01` / `becee55a-1fee-435c-a5b6-4f3d9b3ace43` / Record assigned doctor | event_checklist / resident | Native physician assignment/contact candidate; contact row alone does not establish assignment confirmation. |
| AL-N06 / New Admission G1 | `hfo-al-n06-01` / `a05dd387-e360-4f63-8545-5e3794b44dd8` / Record applicable Medicaid application completion | event_checklist / resident | External Medicaid application evidence; applicability/submission/acceptance separate and unresolved. |
| AL-N07 / New Admission H1 | `hfo-al-n07-01` / `a67a4cf2-ec42-4eb4-b8a4-8fded34180f1` / Record first-month rent received | event_checklist / resident | Native finance payment receipt/period candidate; amount due and approved exceptions needed; invoice existence is not collection. |
| AL-N08 / New Admission I1 | `hfo-al-n08-01` / `137150fa-6282-4cec-bd22-3395e7a38662` / Record admission collections handoff | event_checklist / resident | Collections handoff source unresolved; case existence is not Drive handoff. |
| AL-N09 / New Admission J1 | `hfo-al-n09-01` / `13af1ba5-3b07-4c0d-aaf8-6ab6066aa556` / Add admission event to admission and discharge log | event_checklist / resident | Confirmed admission/arrival event and log reconciliation; no admission created by checklist. |
| AL-C04 / Collections - New Admit E1 | `hfo-al-c04-01` / `fe7467b7-87a7-4373-9f28-fb8cb063559d` / Verify applicable monthly income | event_checklist / resident | Income source/version and applicability require manual verification; no inferred eligibility. |
| AL-C05 / Collections - New Admit F1 | `hfo-al-c05-01` / `063ac891-4d72-46ee-b0ad-244915eb8509` / Record applicable family payer contract signature | event_checklist / resident | Executed contract signer/authority and family payer applicability require verified signing source; no signature creation. |
| AL-C08 / Collections - New Admit I1 | `hfo-al-c08-01` / `f0a9d45a-f6cd-444b-b4bd-62d1127ccbf7` / Record contract copy sent to confirmed recipient | event_checklist / resident | External contract-copy handoff; Q16 current recipient unknown. Source named person is not configured routing. |

## Period and unknowns

Daily, weekly, monthly and audit tabs are source timing evidence only. Require an explicit review interval and facility timezone; do not invent weekday, deadline, shift coverage, exception authority or freshness window. New-admission and collections entries use an explicitly identified admission episode/event and source version; they must not trigger arrival. Facility-wide reviews identify their authorized population and missing coverage instead of claiming all residents from a capped query. All list reads must exhaust pagination or report incomplete.

- Q13: qualified clinical reviewers, procedure, escalation and follow-up closure, medication-system/export authority, DNR/bed-rail applicability and approved clinical thresholds remain unknown.
- Q15: acceptance versus signing versus actual-arrival prerequisites, exception authority, signers/representative authority and printed handoff remain unknown. Best-case pre-arrival signing is not an implemented universal deadline.
- Q23: document capture cadence, verifier, originals/physical binder location, archive handling, rejected/duplicate/misfiled scans and document date versus upload date remain unknown.
- Additional source questions are preserved: Q11 (02/MORS), Q14 (maintenance), Q16 (finance/recipient), Q18 (transition/finance), Q21 (DCF notice), Q24 (provider follow-up), Q25 (emergency packet), Q28 (referrals). COL155 cannot silently answer these adjacent questions.

## Existing code evidence and required API boundary

- `src/lib/residents/resident-detail-overview-load.ts`: reads daily_logs, adl_logs, behavioral_logs, condition_changes, resident_contacts and advance_directive_documents. Its small preview limits are not full review-population coverage.
- `src/app/(admin)/admin/residents/[id]/vitals/page.tsx`: native vital readings use daily_logs; vital_sign_alerts are alerts, not a substitute performed reading.
- `src/lib/admissions/form-1823-readiness.ts`: received status plus received_at/notes, physician_name, exam/expiration dates drives currentness. It does not authenticate physician signature or prove accuracy review.
- `supabase/migrations/056_resident_advance_directives.sql`: operator verification metadata and a role/facility predicate exist. Later effective policies must be reconciled before exposing a new reader.
- `supabase/migrations/037_medication_management_advanced.sql`: verbal-order cosignature metadata exists; it must not be generalized to every order or treated as external signing acceptance.
- `src/app/api/admin/workflows/admission-cases/[id]/confirm-arrival/route.ts`: retain the dedicated actual-arrival command and native authority; review never invokes it.
- `supabase/migrations/358_hfo_source_links.sql`: common source infrastructure; no new clinical-write triggers.

Proposed API/UI needs: server-derived per-component mapping disposition, canonical kind/subject, supported source families, manual-fallback reason, review-period bounds, current readability/finality/version and explicit unavailable/changed reasons. Return provenance references without bearer URLs or clinical payload overexposure. Do not accept browser-supplied finality, author, resident/site relationship or trusted version. POST should record only an explicit administrative review through the existing receipt mechanism; expose no clinical create/update operation. For linked/native-action components, present read-only source context and route to existing authorized native work or manual fallback rather than relabeling the component as a review.

## Proof required before implementation closeout

All 36 items and all components reconcile exactly. Tests must cover wrong resident/site, missing and unreadable source, changed/voided/superseded version, ties/pagination/partial failure, explicit review period, immutable prior review history, revoked native clinical access, and no clinical/arrival/signature writes. SignedDoc, received1823 and DNR operator verification must have negative tests against overclaiming. Backend design and final source allowlist require independent review before UI implementation.

## Reviewed initial implementation subset

Only these canonical resident `record_review` components offer the new current/self review pathway, subject to server eligibility and an approved published requirement:

| Component keys | Installed family | Source-period meaning |
|---|---|---|
| hfo-al-d07-01, hfo-al-a04-01 | rounding | Accepted observation completion event within the explicit review interval; its task/log/resident/site and current correction state must match. |
| hfo-al-d12-01, hfo-al-a05-02 | vital_observation | Native reading event within the interval. D12's Q11 uncertainty remains; reading metadata does not resolve what the source means by 02. |
| hfo-al-m03-01, hfo-al-a03-01 | form_1823 | Document event date by the selected review cutoff plus current site-today validity and matching received evidence, not upload within the review interval. No physician-signature or binder-presence claim. |
| hfo-al-w07-01, hfo-al-a05-01 | form_1823, resident_contact | Partial document context plus current authorized contact metadata at review time, associated with the selected review period. Contact creation is not required to fall within the period or admission day. This is partial packet/file context only. |

The daily/ADL/behavior/condition read surfaces above are candidates for later work, not this initial installed allowlist. Admission, order, DNR, signing, external, finance, nonresident and all event-checklist/structured-observation/native-action components remain explicitly native/manual/unavailable. No component kind is changed. A complete selected-family page set means pagination completed, not all clinical sources reviewed. The new pathway records performance and preserves separate required verification/evidence; it is not an administrative or clinical approval.
