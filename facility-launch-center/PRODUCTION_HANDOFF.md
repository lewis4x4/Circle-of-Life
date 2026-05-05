# Facility Launch Center — Production Handoff

This project is a dependency-light static Facility Launch Center with complete onboarding intake coverage across all 19 modules. It is production-handoff ready as a private static deployment, but it is not a production multi-user PHI/PII system by itself because this folder has no backend, authentication, encrypted storage, or real document upload pipeline.

## Deployment Root

Publish the contents of this folder as the static site root:

```text
facility-launch-center/
├── index.html
├── styles.css
├── robots.txt
├── src/
└── scripts/verify.mjs
```

Do not publish parent workspace PDFs or planning documents unless explicitly intended.

## Required Hosting Controls

Use a private/internal static host with:

- HTTPS only.
- Authentication/access control at the hosting layer.
- `robots.txt` honored and `noindex` meta retained.
- No public search indexing.
- No third-party analytics unless approved for facility data.

## Cache Policy

Recommended headers:

| Path | Cache |
|---|---|
| `/index.html` | `Cache-Control: no-store` |
| `/styles.css` | `Cache-Control: no-cache` |
| `/src/*.js` | `Cache-Control: no-cache` |
| `/robots.txt` | `Cache-Control: no-cache` |

Because there is no build step or content-hashed asset names, avoid long-lived immutable caching.

## Data Handling Warning

The prototype stores all state in browser `localStorage` with an in-memory fallback. Treat all entered data and exports as confidential.

Do **not** enter real PHI, sensitive employee data, bank/payment data, claims narratives, or confidential legal details unless the app is hosted privately and the data handling policy has been approved.

Sensitive examples:

- Employee names, phone numbers, credentials.
- Resident/family/payer fields if added during demo.
- Insurance, claim, and litigation metadata.
- File names that disclose facility risk or coverage.
- Markdown/JSON readiness exports.

## Pre-Deploy Verification

Run from this folder:

```bash
npm run verify
```

This includes:

- Syntax checks for all JS files.
- Static HTTP smoke test for `index.html`, CSS, and module imports.
- End-to-end seeded Homewood remediation/sign/export verification.

## Post-Deploy Smoke Checklist

After deployment:

1. Open the HTTPS site URL in a clean browser profile.
2. Confirm no console errors.
3. Click **Reset Demo**.
4. Confirm Facility Command Center loads Homewood and shows readiness cards.
5. Open Program Charter and edit a field; Gate 0 should update.
6. Open Document Intake and confirm duplicate/source-of-truth controls render.
7. Open Gate Checks and confirm seeded Gate 2 starts blocked.
8. Generate Export and confirm markdown/JSON textareas populate.
9. Confirm page source includes `noindex` and `/robots.txt` disallows crawling.

## Productionization Beyond This Static Deployment

Before real multi-user production use, add:

- Backend persistence and audit trail.
- Authentication and role-based access control.
- Server-side file upload/storage and malware scanning.
- Document parser/extraction pipeline with human review.
- PHI/PII data handling policy and legal review.
- Environment-specific logging and monitoring.
- Automated browser/UI tests.
