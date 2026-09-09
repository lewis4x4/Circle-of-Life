# Independent InsureFlow receiver review

**Verdict: APPROVE for the bounded local, synthetic receiver implementation.**

Reviewed September 9, 2026 against the supplied provider implementation and its developer guide, including the definitive mixed-validity clarification. No live provider request, hosted deployment, production reader approval, or customer acceptance is included in this verdict.

## Independence and exact scope

The reviewer did not author `src/lib/insurance/insureflow/receiver.ts`, migration `338_insureflow_synthetic_receiver.sql`, or its SQL probe. Those files are the independent review scope. The reviewer authored the separate transport/worker lane; that lane requires the parent reviewer’s assessment and is not self-approved here. Its tests are included below as supporting integration evidence.

Final reviewed file hashes (SHA-256):

| File | SHA-256 |
| --- | --- |
| `src/lib/insurance/insureflow/receiver.ts` | `7ae328415ef68b69f647ac489c45fff62431a3310b99481b7bc7031038c155fb` |
| `supabase/migrations/338_insureflow_synthetic_receiver.sql` | `fcb20df440de9286232c1e62f9282cea3e41554662714cd618703bbbba72a5df` |
| `supabase/tests/review_insureflow_receiver.sql` | `9c965b06741c4e42b282571b91bc0cbe889f6e33eb7905506aae5e75793cfde7` |

## Reproduced finding and correction

The first review found that a released event with an omitted `snapshot` property was rejected as invalid page controls. Removing that property from the supplied mixed-validity fixture retained the old cursor and membership instead of applying its unrelated withdrawal. The earlier missing-body test used `snapshot: null` and did not cover an absent property.

The corrected validator accepts complete released-event headers with an absent body and quarantines that body. It still requires withdrawn events to carry explicit `snapshot: null`. An independent reproduction against the corrected reducer returned cursor `7`, two current manifest entries, `snapshot_shape` quarantine for the missing body, and one valid summary. Membership removal proceeded in the same resulting state. No unresolved finding remains from this review.

## Reviewed behavior

- Invalid controls reject the complete page without treating failure as an empty manifest. Invalid bodies produce safe quarantine/recovery records while valid membership changes and unrelated withdrawals proceed atomically.
- First non-null body hashes and event identities remain immutable. Same-ID withdrawn/null redaction removes the body without inventing a new integrity conflict. Existing conflicts stay unavailable.
- Normal and replay cursors remain separate decimal strings. Recovered bodies require a subsequent normal manifest confirmation. Recovery attempts are bounded, and every accepted replay page reconciles its manifest.
- Service-only persistence checks the lease token, configuration generation, expected revision, enabled mode, and expiration. A second expiration check runs immediately before the state update. A stale success or delayed 401 cannot overwrite a newer configuration.
- Generic failures must preserve state exactly. A 401 may change only health and authorization freshness; further claims stop until explicit configuration resolution. The database supplies successful authorization timestamps.
- Read projections check current manager authority, organization, approved mapping, current entity, selected release identity, validation/quarantine/conflict state, replay confirmation, and TTL. TTL is checked again after possible lock waits. Raw receiver tables and audits are unavailable to browser callers.
- Configuration audit entries retain the exact safe provider identity, mapping IDs/approval flags, TTL, and enabled state for create/configure actions. The records are immutable; later remapping cannot erase the earlier approval association. No summary body, raw receipt, credential, or complete receiver state is copied into these audit entries.
- The receiver remains outside canonical policies, claims, financials, document storage, AI/search, and generic raw audit feeds. Live transport is absent from this delivery.

## Executed evidence

The reviewer independently loaded `scripts/pg-verify-stub.sql`, every migration in filename order, and the final receiver probe into a fresh database on the run-owned local PostgreSQL 17 cluster. Each file was applied using `psql --set=ON_ERROR_STOP=1`. The final probe command was:

```sh
psql -h <run-owned-socket> -p 55439 -U postgres -d <isolated-review-database> \
  --set=ON_ERROR_STOP=1 --file=supabase/tests/review_insureflow_receiver.sql
```

**Result: PASS**, including rollback/retry, mapping audit history, immutable audit denial, receipt protection, lease/configuration/failure fences, exact large cursor strings, raw access denial, freshness, mapping changes, entity deletion, recovery confirmation, and operational-store isolation. The isolated review database was dropped after completion.

Supporting local checks were also executed:

```sh
npx vitest run src/lib/insurance/insureflow/receiver.test.ts \
  src/lib/insurance/insureflow/transport.test.ts \
  src/lib/insurance/insureflow/server.test.ts

npx eslint --max-warnings=0 src/lib/insurance/insureflow/transport.ts \
  src/lib/insurance/insureflow/transport.test.ts \
  src/lib/insurance/insureflow/server.ts \
  src/lib/insurance/insureflow/server.test.ts

npm run typecheck
```

Results: **91 tests passed**, scoped ESLint passed with zero warnings, and full application typecheck passed. The worker’s dedicated 14-test suite was rerun after aligning its persistence fake with the SQL rule that stops claims following a rejected credential.

## Limits

The database run used local PostgreSQL with Supabase stubs. It does not prove deployed gateway behavior or production authorization configuration. Real source-account mappings, staging credentials/origin, production freshness and retention decisions, production readers, and live rollout approval remain unresolved. This review authorizes no deployment or live connection.
