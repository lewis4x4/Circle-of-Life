# COL-217 and COL-143 staging closeout

Authorized new Supabase project: Haven HFO Staging / iwcnajanvjvynolltflw / Circle of Life organization / us-west-2 / Micro. Brian approved creation and staging integration with “Handle it.” and “Please proceed.” Production excluded.

Tested app/source: codex/hfo-col217-staging-integration at b3e1d819874c942afb737f46eaa632ba54de247c. Source core gates,4410 tests,366 migration files/46 SQL probes passed. Canonical main migrations unchanged;27 staging-only copies normalize seed identities/data and three enum transaction boundaries. Schema and ACL equality and independent copy review passed; applied-copy hashes remain distinct.

Staging replay complete:366 ledger entries through363. Private evidence bucket, six Storage policies, checksum amendment, Auth access-token hook and current request guard verified. Public signup disabled. Inherited seed users banned/inactive; synthetic-only final seed records. Source replay/rebuild failures retained in private logs and safe setup summary.

Hosted proof: four completed performance flows(admin,assistant,late,required-checksum-failure+validretry), actual corporate download bytes, authorization/immutability/stale/revocation/anonymous negatives.164 redacted records. Independent Codex technical review PASS. Cleanup: exactly7ownedobjects deleted,4testactors banned/inactive,sitegrants revoked,2sites+1entity retired. Immutable4receipts7evidence22events retained. No human staff/release acceptance claimed.

Local app4317 stopped after testing; staging Supabase persists. Private app environment remains in integrationworktree .env.local; management/staging secrets remain ~/.config/haven-staging/col217.env. Do not print credentials. Retired fixture credentials/browser states are private and no longer active. Do not rerun reset scripts: accepted staging now contains retained proof history and their guards should refuse.

Authenticated Today/History+invoice reads passed on desktop/mobile. Separate UI issues:COL-221contrast,COL-222landmarks,COL-223historicalreceiptwording,COL-224one hydration observation requiring diagnosis. No claim of full UI/staff/go-live acceptance.

Next dependency-ready core implementation after COL-143 delivery closeout:COL-149 corporate Facility→Activity→complete History. COL-140 approved Homewood profile and COL-161 technical release remain separate. Final source/evidence PR and Linear readbacks are recorded by the parent closeout.
