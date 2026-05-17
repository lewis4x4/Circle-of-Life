# homewood-residents.csv — Data Provenance

Generated 2026-05-16. Every field traced to one of two sources:

- **AR** — `AR May 2026.xlsx`, Homewood Lodge tab (Google Drive file `1HMm0PXnA6yKvgaQeZ9F4lcRJo2OFFGCe`)
- **FS** — Per-resident face sheet `.docx` in HW Face Sheets folder (`1q5RnQODacE81nB09QIsrMsf66498EERr`)

## Field-by-field provenance

| Field | Source | Transformation |
|---|---|---|
| `first_name` / `last_name` | FS `RESIDENT NAME` cell | Parsed name into first / last. Multi-word names: middle name dropped (see "Names dropped" below). When AR and FS spell the name differently, **FS used** (FS is the resident's source-of-record document). |
| `preferred_name` | (none) | Always empty — no nickname field exists in either source. |
| `date_of_birth` | FS `DOB` cell | Converted to `YYYY-MM-DD`. No values changed; only format. |
| `gender` | FS `GENDER` cell | Lowercased to schema enum (`female` / `male`). No values inferred. |
| `room_number` | AR `Room #` column | Verbatim. |
| `admit_date` | AR `Admit Date` column | Converted to `YYYY-MM-DD`. No values changed. |
| `primary_diagnosis` | FS `MEDICAL HISTORY` cell | **Verbatim** including original capitalization, typos, and weird comma placement. CSV-quoted. |
| `payer_type` | AR `MCD Provider` column | **Derived** — see rule below. This is the only non-verbatim field. |
| `emergency_contact_name` | FS `Emergency 1` row, name cell | Verbatim. |
| `emergency_contact_phone` | FS `Emergency 1` row, phone cell | Digits/dashes only. When source mashed phone + email into one cell, only the phone digits were extracted — flagged below. |
| `emergency_contact_relationship` | FS `Emergency 1` row, relationship cell | Verbatim including original capitalization and embedded spaces (e.g. `Daughter/ POA`). Empty cells left empty. |

## `payer_type` derivation rule

The schema's `payer_type` enum (`private_pay`, `medicaid_oss`, `ltc_insurance`, `va_aid_attendance`, `other`) does not match AR's columns directly. Rule applied:

- AR `MCD Provider` cell contains `UHC`, `FCC`, `Humana`, `Sunshine`, or `Simply` → `medicaid_oss`
- AR `MCD Provider` cell is empty AND PVT amount = total contracted → `private_pay`
- AR `MCD Provider` cell says `MCD Pending` (still paying privately while application processes) → `private_pay`
- **Special: Chick, Sara (16A)** — AR has empty MCD Provider but Medicaid is actively billing $1,600/mo (paid). Inferred `medicaid_oss` from billing activity, not provider cell.

This is the only field in the CSV that involves judgment. If you want zero inference, the entire `payer_type` column can be re-derived later from billing records.

## Row removed (incomplete source)

- **Coone, Karen (Room 16B, admit 2026-05-04)** — face sheet `GENDER` cell is **empty**. Schema requires gender. Rather than guess from name, the row was excluded. Other data captured for reinsertion when staff fills gender:
  - DOB: 03/08/1953
  - Medical History: "Hypothyroid, Glaucoma and Osteopenia"
  - Emergency 1: Karen Coone, 386-389-1462, Daughter
  - AR Payer rule: `private_pay` (MCD Pending)

## Discrepancies between AR and face sheet (FS spelling used)

| AR spelling | FS spelling | Used in CSV | Note |
|---|---|---|---|
| Miller, Jonnie | Miller, Johnnie Sue | `Johnnie Miller` | FS shows legal name; AR has informal spelling. |
| Strum, Deborah | Sturm, Deborah | `Deborah Sturm` | AR appears to be a typo. |
| Dicken, Robert | Dickens, Robert | `Robert Dickens` | AR appears to be missing a letter. |
| Hancock, Carolyn | Handcock, Carolyn | `Carolyn Handcock` | **Both spellings appear in sources.** FS resident-name cell says Handcock. Verify with ID document before billing. |

## Middle names / suffixes dropped from FS resident-name field

The schema only has `first_name` and `last_name`. These middle names/suffixes were present in FS but **not stored**:

| Resident | Full name in FS | Stored as |
|---|---|---|
| Brownell, Peter Othal | Peter Othal Brownell | first=Peter, last=Brownell |
| Murray, Kenneth A | Kenneth A Murray | first=Kenneth, last=Murray |
| Hurley, Charlie Melvin Jr | Charlie Melvin Hurley Jr | first=Charlie, last=Hurley |
| Wuerfel, John William JR | John William Wuerfel Jr | first=John, last=Wuerfel |
| Deloy, Joseph Hugh | Joseph Hugh Deloy | first=Joseph, last=Deloy |
| Miller, Johnnie Sue | Johnnie Sue Miller | first=Johnnie, last=Miller |
| Baker, Jimmie Lou | Jimmie Lou Baker | first=Jimmie, last=Baker |
| Dionne, Carol S | Carol S Dionne | first=Carol, last=Dionne |
| Thompson, Joseph Michael | Joseph Michael Thompson | first=Joseph, last=Thompson |

## Phone cells with email mashed in (digits-only used)

These FS phone cells contained the resident family member's email after the phone number (no separator). Only the phone digits were stored:

- **Wheeler, Marsha** — Karon Hegland cell: `352-359-1830Kwheeler1979@gmail.com` → stored `352-359-1830`
- **Handcock, Carolyn** — Ron Anderson cell: `321-446-9528ronandersonjr@icloud.com` → stored `321-446-9528`
- **Riggins, Christine** — Anita Wilkinson cell: `(h) 386-431-1833© 904-496-9110alw1958@windstream.net` → stored `386-431-1833` (home phone; cell phone `904-496-9110` also present in source but not stored — schema only has one phone field)
- **Bowman, Damaris** — Brenda Bowman Sizemore cell had email after phone → stored `850-274-6670`
- **Baker, Jimmie Lou** — Barbara Strother cell contained two phones with no separator: `229-443-3855229-443-3856`. Stored first phone only: `229-443-3855`.

## Suspicious source data (left as-is; verify before billing/clinical use)

These look like errors in the FS source documents themselves, not in the CSV:

- **Chick, Sara** — FS DOB `11/11/2004` (age 21). Diagnosis text is identical to Murray Kenneth (boilerplate). Relationship to Emergency 1 (Constance Buchanan) is blank in FS.
- **Murray, Kenneth A** — FS DOB `10/12/1988` (age 38). Same boilerplate diagnosis text as Chick.
- **Four residents share Emergency 1 = "Constance Buchanan"** (Brownell, Chick, Sturm, Lee) — likely facility admin filling in for residents without family contacts. Phone `904-400-4727` shared by three; Lee's variant is `386-755-0388`.
- **Carolyn Handcock medical history** says `Hypertension- Dementia` (dash, not comma) — verbatim from source.
- **Several FS diagnoses have garbled words**: "Hyper homocysteine Mía" (Chewning), "Cmbolidm J Aewte Caplan" (Riggins), "CAD Sleep Apical" (Brownell), "Hight Cholesterol" (Nguyen), "VITAMIN DEFICENCY, BRADYCADIA" (Dickens), "HYPOLIPEDEMIA" (Polk). All preserved verbatim.

## What was NOT imported

The face sheets contain additional fields the schema does not cover (and the import script intentionally skips):

- SSN, Race, POA name (separate from emergency contact), DNRO / Living Will, Marital Status, Spouse, Religion, Veteran status
- Insurance Medicare/Medicaid ID numbers
- Allergies, diet, height/weight
- Pharmacy info, care provider name
- Emergency contacts 2 and 3
- Funeral home, hospital designation, transportation
