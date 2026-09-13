# COL-217 — concrete staging decision

September 12, 2026. Status: approved by Brian with “Handle it.”; project iwcnajanvjvynolltflw created and independently verified. Integration/testing underway.

## Verified

Live Supabase CLI inventory lists three projects in the Circle of Life organization: production Haven (`manfqmasfqppukpobpld`), Front Office, and GSMS Developers. No Haven staging project was found. Haven's branch-list response was `null`; the GitHub repository's environment list was empty. This is stronger evidence than the earlier local-only preflight, but applies to the account currently accessible.

## Proposed decision

Create **Haven HFO Staging** in the existing **Circle of Life** organization (`macizkpxodsegtptaytu`), **us-west-2**, **Micro** compute. Codex handles the isolated source integration, staging preparation and redacted verification evidence. Use synthetic fixtures only. Run the test app locally against the new hosted project, so no additional Netlify site is necessary for COL-143 proof.

Additional Micro compute starts around **$10/month, billed hourly**, plus applicable usage. No optional add-ons, compute upgrades, custom domain, production-data clone or production changes are proposed. Exact account charges must be checked when provisioning; the published estimate is not a spending cap. Official pricing: https://supabase.com/docs/guides/platform/billing-faq and https://supabase.com/docs/guides/platform/manage-your-usage/compute .

## Source inputs and execution scope

- Current main: `50bc07c4c877b65e17f471895e4446ff11c4d69c`.
- Finance source: `0d0e7763e9fcccbe957a48fba3da7564e9356fd5` on `codex/haven-finance-integration`.
- HFO source through reminders: `b83bf7b5fe8830c9d2be29c0a16d8cf7b3b48580` on `codex/hfo-col152-reminders`.
- Build a fresh isolated integration branch. Reconcile Finance before HFO authority, preserving current main's already installed migration history. The old runbook's baseline 335 and numbering table are historical and must not be used unchanged.
- Verify the integrated migration sequence locally before applying to the new empty staging target. Record the resulting exact integration SHA; none is claimed yet.
- Independently verify the new project ref differs from production before any staging SQL, Auth or Storage mutation. Configure the required Auth hook, pre-request guard and private evidence bucket; keep Storage schema outside public API exposure. Store credentials through private local configuration, never in Linear or committed artifacts.
- Produce the hosted upload/finalize/completion/download and negative authorization evidence under COL-143. Its independent review and any later staff/release acceptance remain separate.

## Approval recorded

Brian approved this proposed scope with “Handle it.” The new project is provisioned. Codex is the staging integrator. Exact tested integration SHA and hosted proof are recorded during execution; no further approval is required for this already authorized Micro setup.
