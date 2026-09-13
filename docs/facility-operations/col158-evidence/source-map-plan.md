# COL158 provider report UI and source plan

Plan before implementation. AL-H01 has exactly one canonical component: `hfo-al-h01-01`, UUID`2e061e2d-05e2-431b-b371-6a8bdf17f3f6`, record_review/resident, Community Support Plan. The catalog is draft/needs_confirmation. Q08/Q24/Q27 and unconfirmed Plantation/Hope applicability remain explicit. Monthly grid review and interview six-month renewal are separate unresolved rules, not activated schedules.

## Typed interaction boundaries to agree

Task-bound current native document/clinical AND HFO resident authorization governs every expectation, contact, document version, signature claim, history and download. WorkRow integration uses server-authorized activity_key, task/resident/site/current actor and clears all private form/source state on changes or failed reads. Unsupported/read-denied means unavailable, never empty or complete.

Server reply must independently identify:

- Service state: unknown or operator-attested with actual service date/time, current contact/version and confirmation provenance. No provider-finality claim from visitor sign-in/contact/upload.
- Expected document: explicit type (1823, hospice, community/support plan, other/unknown), expected version description, reason, owner/unassigned, immutable revision.
- Timing: approved due rule/provenance only when recorded; absent means unknown and not overdue. Chase commitment date is separate. Existing issue lifecycle owns follow-up/backup, not a new task engine.
- Native receipt: exact resident_document/version identity, actual received time/channel and currentness; verified transport means bytes/access, not clinical validity.
- Administrative review: actual current actor/time/findings and distinct state. Review does not verify clinical content, complete HFO performance, renew the report or create another person's signature.
- Signature observation: role, actual signer label, exact document version/page, observed source and signed date only if evidenced. UI says operator-observed paper evidence, never authenticated electronic signature. Caseworker/resident/administrator are possible individual observations, not automatically required three-signature policy.
- Supersession/renewal: old version/review/individual signature observations stay historical; nothing carries onto a replacement silently. Renewal is separate from monthly review and approved due rules.

POST actions need stable request_key/expected_revision and strict discriminated payloads. Uncertain commands keep exact body and lock competing changes; retries do not duplicate. Read/version changes invalidate stale drafts. No native clinical data, provider message or automatic completion mutation from generic panel refresh.

## Native document intake

The additive native bridge reuses resident_documents as canonical identity plus immutable child versions and private native storage. HFO holds citations only, never file duplicates. Client chooses local file and factual type/title; server issues bound native version/object identity, MIME/size constraints and authorized upload mechanism. No caller-selected bucket or arbitrary path. Upload actual bytes, finalize only after server verification; no finished receipt on partial upload. Wrong resident/type/object/version, overwrite and revoked scope fail closed. Native-only document access cannot create HFO report claims; HFO-only access cannot expose native bytes or metadata.

Download uses new scoped native route with current native+HFO authorization. Avoid persisting reusable signed URL or object path; URL exists only for immediate controlled download. Make signed-URL lifetime limitations explicit in evidence. Signature/page claims bind only readable finalized native versions. Existing Form1823 receipt/currentness and admission signing statuses remain separate; no generalization to validated provider signatures.

## UI layout and proof

Use labelled nonlandmark groups within existing WorkRow details. Keep one simple factual command at a time; show all axes separately with plain labels and explicit unknowns. Use existing controls/date-time facility timezone conventions, request-abort/reset and exact-retry patterns. No clinical intake form or new provider-signing UI. Show current actor/time for current attestations; document signed/received/service times are factual sourced times, not forged recorder attribution.

Tests: unknown due not overdue; visit/service attestation withoutreport outstanding; receive does not review/sign/renew; three observedroles eachversion/page-bound without inventedrequiredset; oldsignatures remainold aftersupersession; stale/wrongscope reply clearsprivatevalues; uncertain retriesbytewise; upload/finalizefailure no success; revoked native/HFO download denied; multipleopenpanelsaxe; actual375/1440viewportshots andlongreferencewrapping.

Hosted proof later requires reviewed exact-source/gates/370binding, freshisolatedorg/site/resident/contact/actors, readable synthetic multi-page PDF using existing libraries, actualnative upload/finalize/receipt/download hash, explicit operator-observed page evidence, superseded secondversion, missingreport/unknowndue/chase versusrule, native-only/HFO-only denial and exactcleanup retainingnativeversion/audit history. No hostedcalls or sourceactivation before parent readiness. Synthetic PDF text must clearly identify its synthetic fixture status and actual example signature-role/page marks; it must not impersonate a real provider or resident.
