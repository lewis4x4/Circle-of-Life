# Corrected risks and external decisions

2026-09-08. Severity is implementation prioritization, not a legal conclusion. Owners below describe accountable functions; a name appearing on a form does not confirm the current owner. No external messages have been sent.

| ID | Priority | Evidence and corrected finding | Build treatment / closure evidence |
|---|---|---|---|
| R01 | High | S12 p10 I-9 shows 07/31/2026 expiration. USCIS's 2024 update specifies a version with 05/31/2027 expiration starting August 1, 2026. | Link to current USCIS form selection; disable historical packet copy for new execution. HR reviews affected completed forms with appropriate guidance, preserving originals. Do not automatically invalidate every older completed I-9. |
| R02 | Medium | S12 pp6–9 contain 2024 W-4. | Use IRS current revision link for new collection; don't imply everyone must replace a valid existing withholding certificate. |
| R03 | High | S3 p23 safety acknowledgment names Rising Oaks; p24 program and p19 drug policy contain site-specific language. Five legal-entity mappings are not proved. | Version templates by approved employing entity/facility. DEC-03 required before production publication. |
| R04 | High | S3 p3 emergency form includes medical questions; S45 pp32–36 collect health/vaccination/TB information. S3 drug acknowledgment includes medical release. | Separate confidential medical access and audit it. Storage bucket/role design is an implementation choice; passing actual authorization tests is mandatory. Keep health narratives out of ordinary HR search/exports. |
| R05 | High | S45 p5 instructs email transmission of new-hire/direct-deposit/W-4 paperwork. | Replace new intake with authenticated restricted upload or authorized payroll workflow. Actual email encryption and Gmail usage are unverified; no assertion of a confirmed data breach. |
| R06 | High | S3 p27 says three or more employees hospitalized within eight hours. | Corrected source: work-related fatalities within eight hours; qualifying inpatient hospitalization of one or more employees, amputation, or loss of an eye within 24 hours. Preserve event occurrence and employer awareness timestamps; timing exceptions and reportability require trained review. Do not deploy the old rule. |
| R07 | Medium | S45 p32 Hepatitis B election should be checked against OSHA's prescribed declination language where occupational-exposure standard applies. | Current approved statement and applicable population required before digital form publication; preserve voluntary choice and later election. |
| R08 | Medium | Attendance S3 pp8–10 excludes FMLA leave. | Employer coverage differs from individual eligibility. Do not determine either from a five-facility count. Pending leave review prevents automatic punitive calculations. DEC-05. |
| R09 | Medium | S12 p2 index names Workers Comp, FMLA and Time Off Request. Standalone forms not located in delivered pages. | Mark missing-source, not missing employee completion. Obtain current forms; also request referenced coaching/grievance/accident forms. |
| R10 | Medium | Drug policy S3 pp16–22 includes testing cutoffs, challenge periods and discretion. | Do not interpret tests in Haven or automate disciplinary outcomes. Current MRO/laboratory policy and legal review required. Cannabis treatment and lab contact details remain unverified. |
| R11 | Medium | Attendance wording contains grammatical ambiguity and overlapping tardy/absence tracks. | Remove unsupported prediction about an unemployment appeal. Counsel/HR approves clarified text and aggregation examples before operational automation. |
| R12 | Low | S45 p7 says Location of MSDS. | Proposed display label Location of safety data sheets (SDS), preserving original label/version provenance. Safety owner verifies actual location and materials. |
| R13 | Medium | S3 p15 photo/video consent has broad duration language. | Keep optional consent separate from employment clearance; approved withdrawal/post-employment treatment required. Do not infer irrevocability is legally settled. |
| R14 | Medium | S3 p32 describes DPC; packet does not establish total FTEs, controlled group or absence of other insurance. | Benefits/tax adviser evaluates actual workforce and plans. Bed count is not ACA employer-status evidence. No automated coverage claim. |
| R15 | Medium | S45 p17 screening form collects sensitive identifiers. | Restricted retention/export policy and authenticated access. Paper security and current retention practice are unverified. |
| R16 | High | S45 p8 password field. | Never collect or expose passwords in personnel records, exports or knowledge search. Invitation/status replaces the field. |
| R17 | High | S45 p7/p26 medication training quantities differ. | Record sessions and attestations without automatically declaring competency from a count. DEC-02. |
| R18 | High | Audit role/facility timing mappings were inferred in pasted text. | All draft rows and unknown applicability remain visible and inactive until approved. No default global LMH or administrator full-set mapping. |

## Official reference checks

Accessed/search-verified September 8, 2026. A link is a reference for review, not authorization to file or transmit employee information.

- [OSHA reporting](https://www.osha.gov/report/): fatality and severe-injury reporting distinctions. Main URL without trailing slash returned 403; official indexed result and [OSHA severe injuries](https://www.osha.gov/severeinjury) corroborated the correction.
- [USCIS form updates](https://www.uscis.gov/forms/forms-updates?ftopics_tid=0&page=10): August 19, 2024 update states the August 1, 2026 version transition. Main I-9 page returned 403 in this review; retrieve the current official form at publication time rather than treating this old update as a complete list of currently accepted editions.
- [IRS W-4 current revision](https://www.irs.gov/forms-pubs/about-form-w-4): official maintained form link. This run verified the current revision landing page, not the bytes of the linked form.
- [DOL FMLA fact sheet](https://www.dol.gov/agencies/whd/fact-sheets/28-fmla): private-employer coverage uses employee count/workweeks; employee eligibility additionally considers tenure, hours and work location.
- [EEOC health care workers and ADA](https://www.eeoc.gov/laws/guidance/health-care-workers-and-americans-disabilities-act): confidential medical information treatment, not a prescribed Supabase architecture.
- [OSHA bloodborne pathogens](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1030) and [declination enforcement guidance](https://www.osha.gov/enforcement/directives/cpl-2-244c): applicable employee declination statement requirements.

## External decision queue

These are specific unresolved business decisions, not permission requests for continuing implementation. Build drafts, evidence capture, review queues and access controls while these remain open. Only dependent policy activation is blocked.

| ID | Accountable function | Concrete decision / requested evidence | Dependent activation |
|---|---|---|---|
| DEC-01 | Compliance and facility operations | Current licenses/LMH designations; role, duty and facility training matrix with individual timing/renewal authority | Training applicability and clearance rules |
| DEC-02 | Training lead and medication supervisor | Resolve x3 versus two days; course vs hands-on dates; evaluator qualifications and pass criteria | Medication competency completion rule |
| DEC-03 | HR and legal | Verified employing-entity/facility map; approved site-specific template language and job duties | Employment agreements and policy publication |
| DEC-04 | HR operations | Missing indexed forms; current job descriptions; coaching, grievance and accident report forms | Completeness denominator and those workflows |
| DEC-05 | HR/legal | FMLA coverage and eligibility handling; leave exclusions; tardy-to-absence overlap; probation boundaries; good-citizen eligibility examples | Attendance candidate calculations beyond conservative review records |
| DEC-06 | Benefits/tax adviser | Current plans, actual workforce/FTE and related-entity facts; approved DPC provider/eligibility terms | Benefit eligibility and ACA representations |
| DEC-07 | HR/legal and safety | Current government forms; Hep B wording/applicability; OSHA reporting procedure; medical/cannabis/photo policy | Revised regulated forms and policies |
| DEC-08 | Records/privacy and system owner | Retention schedule, confidential role grants, payroll/provider handoff destination, lawful e-signing process | Live sensitive-document intake and export |
| DEC-09 | Operations | Confirm current safety coordinator, MRO, laboratory, referral and emergency contacts | Operational contact publication |

Close a decision with named accountable approver, dated evidence, version, effective date, and affected requirement codes. Preserve the former decision and source. Reject a completion attempt if its only justification is an unapproved draft requirement.
