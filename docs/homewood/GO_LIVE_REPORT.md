# Homewood Lodge ALF — Go-Live Report

_Generated: `2026-05-16T15:10:46.054Z`_

## Top line: **NO-GO**

One or more pre-flight gates failed. The detail below shows which gate, the exit code, and the tail of stderr/stdout. Resolve the failure and re-run `npm run homewood:preflight`.

## Gate summary

| Gate | Status | Detail | Last run |
|---|---|---|---:|
| typecheck | ✅ pass |  | 1.7s |
| lint | ✅ pass |  | 14.2s |
| build | ✅ pass |  | 30.5s |
| homewood:audit | ❌ fail | DATA_AUDIT.md surfaces 1 CRITICAL anomaly category | 5.5s |

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

