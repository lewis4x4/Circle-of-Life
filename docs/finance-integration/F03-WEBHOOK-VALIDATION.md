# F03 private QBO webhook validation primitive

This slice implements `supabase/functions/_shared/qbo-webhook.ts`. It is **not a public receiver, acknowledgment endpoint, durable inbox, tenant authorization check or processed-event ledger**. It makes no network calls and has no credentials/configuration discovery. QBO remains a reference path pending actual product, company, app and environment decisions.

## Interface and evidence separation

`validateQboWebhook({ body: Uint8Array, headers: readonly [string, string][], verifierToken: string })` returns a discriminated result:

- `ok: false, authenticated: false`: authentication was not established; only fixed error codes and a minimized `logSummary` are returned. This includes pre-authentication policy rejection, not just an incorrect signature.
- `ok: false, authenticated: true`: the HMAC was valid but decoding, syntax, schema, limits or within-request identity consistency failed. `evidence` retains the exact authenticated body hash and a `copyAuthenticatedBody()` accessor for a future durable quarantine. No provider text appears in diagnostics.
- `ok: true, authenticated: true`: `privateMetadata` contains the preserved provider identifiers, type, time, optional content type, identity/event-byte hashes and event byte ranges. `logSummary` contains only a fixed validation code, authentication flag, body digest and event count. `evidence` retains the complete authenticated body.

**Never ordinary-log the entire result or `privateMetadata`.** Company/entity/event IDs and sources can identify sensitive preexisting accounting records. Raw `data` remains solely in the evidence bytes; it is not copied into parsed metadata. Even minimized digests/counts require the application's approved telemetry and retention policy. The verifier and signature never appear in returned results.

The helper copies the input synchronously before its first asynchronous cryptographic operation. Returned raw-body access produces independent copies; metadata and byte-range objects are frozen. The caller must still collect the original body without JSON reserialization or text normalization and enforce a streaming size limit before buffering. Pass preserved header lines where available. Duplicate signature/content-type lines and comma-joined duplicates fail; a proxy that silently discards duplicates before this helper is outside this proof.

## Accepted profile and authentication

The helper checks canonical 32-byte base64 `intuit-signature` using Web Crypto HMAC-SHA256 against the exact input bytes. It verifies the signature **before UTF-8 decoding or JSON parsing**. The configured key is used as its exact UTF-8 string, without trimming or normalization.

The current Intuit profile follows the [official CloudEvents announcement](https://medium.com/intuitdev/upcoming-change-to-webhooks-payload-structure-2a87dab642d0), [official migration guide](https://github.com/IntuitDeveloper/Prompt-Library/blob/main/workflows/webhooks-migration/prompt-template.md) and [research notes](QBO-CONNECTION-RESEARCH.md):

- A nonempty top-level JSON array; each event requires `specversion: "1.0"`, `id`, `source`, `type`, `time`, `intuitentityid`, `intuitaccountid`, and an object-valued `data`.
- `datacontenttype` is optional and, when present, must denote JSON. HTTP content types are `application/json` or `application/cloudevents+json`, optionally declaring UTF-8; media-type/charset casing is insensitive.
- Identifiers are bounded, nonempty strings, preserved verbatim after JSON string decoding. No numeric coercion or tenant lookup occurs. Type syntax is `qbo.<entity>.<operation>.v<positive version>`; matching that syntax does not establish support for the entity or operation.
- Provider timestamps retain their original offset/casing and up to nine fractional digits. Gregorian dates and clock fields are checked. There is no freshness test or checkpoint. Leap-second timestamps are outside this local profile.
- Unknown outer event fields, including null-valued fields, are rejected. Optional generic CloudEvents extensions such as `subject`, `dataschema`, `traceparent`, and `data_base64`, legacy envelopes, and `application/cloudevents-batch+json` are deliberately unsupported rather than silently assumed compatible. Future support needs reviewed provider evidence.

Local defensive bounds are **1 MiB**, **1,000 events**, JSON depth **32**, **100,000 values**, and **128 header lines**. Metadata/key strings have explicit length/control-character restrictions in source. These are Haven limits, not claimed Intuit delivery limits. Invalid UTF-8, duplicate decoded JSON keys at any depth, trailing bytes and malformed JSON are rejected. Authentication-valid failures retain raw evidence; an eventual receiver must durably handle that evidence before deciding how to respond.

## Fingerprints and future inbox responsibility

The body digest covers all authenticated bytes. Each event digest covers its exact object byte range, excluding surrounding array whitespace and separators. A grammar scanner locates ranges and detects duplicate keys without converting numeric lexemes. Temporary JSON parsing is used for field validation, **never to regenerate the fingerprint**. Thus large numbers, exponent notation, property ordering and internal whitespace cannot silently collapse through JavaScript floating-point conversion.

The identity digest is SHA-256 over the UTF-8 encoding of `JSON.stringify(["qbo-cloudevent-identity-v1", source, id])`. A future inbox must additionally namespace identity by its trusted app registration/environment and independently validate each company's binding. The helper neither visits a `source` URL nor creates bindings for unknown realms.

Repeated byte-identical events remain in the returned array: this helper has no durable deduplication state. Within one request, reuse of the same source/event ID with different event bytes rejects the request while retaining authenticated evidence. Across requests, the future inbox must compare the supplied fingerprints and quarantine conflicts. Serialization changes inside an event deliberately produce conflicts; this is **not semantic equivalence detection**. Signature validity, time, event ID and successful parsing do not prove freshness, completeness, financial success, durable receipt or prior processing.

## Executed local proof

The Deno suite uses `node:crypto` as an independent HMAC/SHA-256 oracle and the published [RFC 4231 test case 2](https://www.rfc-editor.org/rfc/rfc4231.html#section-4.3) as a fixed known vector. It exercises exact whitespace/non-ASCII bytes, wrong/missing/duplicate headers and keys, invalid UTF-8/JSON, duplicate decoded keys, required/unknown/wrong fields, nanoseconds/calendar validity, mixed companies, private-log separation, identity conflicts, large numeric lexemes, input/evidence mutation, all 1,000 accepted events and exceeded limits.

The 24 cases are tagged `HFA-024` and passed using Deno 2.6.9 with no application network/environment/filesystem permissions. Deno type checking and lint passed without disabled rules. Machine-readable case/count/command/source hashes and retained logs/JUnit are under the private run manifest at `/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/webhook-primitives/manifest.json`.

This is local cryptographic/schema proof using synthetic keys and payloads. Actual Intuit signatures, sandbox delivery, proxy/header preservation, streaming ingress, acknowledgment behavior, durable inbox/quarantine, replay handling, current realm authorization and business acceptance remain unverified or unimplemented.

Independent root review approved the exact helper source after24 Deno assertions and314 additional deterministic JSON/HMAC/byte-range cases. Durable evidence is in `test-results/finance-integration/f03-webhook/review.json`; the ordinary suite runs as `npm run test:finance-webhook` in unconditional PR CI. All remaining receiver/inbox/provider limitations above remain open.
