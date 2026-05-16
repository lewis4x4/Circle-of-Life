# Homewood Lodge ALF — Go-Live Report

_Generated: `2026-05-16T15:07:57.467Z`_

## Top line: **NO-GO**

One or more pre-flight gates failed. The detail below shows which gate, the exit code, and the tail of stderr/stdout. Resolve the failure and re-run `npm run homewood:preflight`.

## Gate summary

| Gate | Status | Detail | Last run |
|---|---|---|---:|
| typecheck | ✅ pass |  | 1.6s |
| lint | ✅ pass |  | 14.3s |
| build | ✅ pass |  | 29.7s |
| homewood:audit | ❌ fail | DATA_AUDIT.md surfaces 1 CRITICAL anomaly category | 8.1s |

## Per-gate detail

### typecheck

- **Status:** pass

### lint

- **Status:** pass

### build

- **Status:** pass

### homewood:audit

- **Status:** fail

```
DATA_AUDIT.md surfaces 1 CRITICAL anomaly category
```

---

_Source: `scripts/homewood/preflight.mjs`. Re-run with `npm run homewood:preflight`._

