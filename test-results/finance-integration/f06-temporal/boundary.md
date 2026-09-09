# Temporal payer selection — bounded F06 proposal

Source baseline: F06 guards committed as d1023d14. This is a payer-interval guard, not split billing, historical reconstruction or new accounting policy.

The known billable interval is the inclusive intersection of the requested civil month and the resident's recorded admission/discharge interval. Admission is required to establish that interval; invalid/missing admission, invalid discharge or reversed dates requires review. An interval outside the requested month produces no charge. Holds do not shorten this interval under the July interim policy.

Read all nondeleted primary payer rows for the facility with the existing exact-count completeness guard. Selecting only effective_date<=monthStart is incorrect for an admission later that month. Removing the old end_date>=monthStart filter preserves ended rows for interval validation. Validate the returned rows before classifying them; do not use SQL row order as payer priority. Valid rows wholly before/after a resident's billable interval are ignored. No new pagination or enlarged cap is introduced; an incomplete source still blocks.

When no primary overlaps the interval, retain the established private-pay default from the existing private-rate path. This is the existing no-current-payer behavior and matches the supplied May-private/June-Medicaid case. It does not prove missing or overwritten historical payer facts. When one primary overlaps, it must cover every billable day. Multiple overlaps, sequential primary changes or partially covered intervals block the preview and require a real split/allocation or corrected source. Never select whichever primary happens to be last.

The bounded implementation will preserve current published/superseded schedule reads and agreement/rate calculations, modifying only payer selection and invalid-window handling in the two exact producer copies. Existing source-guard assertions remain; fixture rows receive their real-schema payer id/effective_date/end_date fields. A separate temporal suite will execute both actual producers with independent expected charges, including leap/DST civil dates. An ambiguous resident will block the facility preview, giving no invoice RPC path through existing handlers.

## Required later engineering, not policy waivers

The end-to-end finance handoff supersedes the old BH-3 split-payer deferral. Real Medicaid/patient responsibility, fixed/percentage/remainder shares, secondary payers, mid-period responsibility changes and payer-specific immutable invoice identity still require implementation. The current one-invoice/facility/resident/period index prevents silently adding two monthly invoices. Do not bypass it by inventing new period starts or new invoice identities.

Resident current status is not a historical eligibility timeline. Payer imports mutate rows in place; current rows and rate caches cannot reconstruct overwritten historical terms. True historical charging requires reviewed source provenance/history. Provider rate units, authorization-based reduced rates and mid-period rate/agreement changes remain separate required work. No unverified history or new charge split is inferred by this selector.
