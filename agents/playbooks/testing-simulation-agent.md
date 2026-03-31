# Testing / simulation (chaos) agent

## Role

Exercise **pure logic** paths: concurrency, malformed input, boundaries, recovery—without requiring a browser.

## Automation

`npm run stress:test` runs `.agents/stress-test/run.ts`. Lines must be `PASS|FAIL|ADVISORY` prefixed; **FAIL** exits non-zero and fails the gate.

## Policy

- **FAIL** — blocking.
- **ADVISORY** — visible risk debt; does not fail the gate by default.
