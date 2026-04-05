# 17 — Entity & Facility Finance (Phase 3)

**Dependencies:** `00-foundation`, `16-billing` (relationship: GL is separate from AR; `invoices` / `payments` carry `entity_id` for future posting integration)  
**Build week (target):** 21–22 (first slice); follow-on slices TBD  
**Migration sequence:** `040_*` (first migration for this module; follows `039_compliance_engine.sql`)

---

## Implementation note (repo migrations vs spec SQL)

- Spec snippets below use `auth.organization_id()`, `auth.accessible_facility_ids()`, `auth.app_role()` for readability, matching `00-foundation.md` style.
- **Migrations in this repo** implement equivalent policies using **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`** in schema `haven` (see [README.md](README.md) implementation note). Translate policies verbatim when applying DDL.
- Trigger functions: **`public.haven_set_updated_at()`** and **`public.haven_capture_audit_log()`** (see `006_audit_triggers.sql`); attach triggers per table as in other modules.

---

## Purpose and operator value

**Entity & Facility Finance** gives multi-entity operators a **double-entry general ledger** scoped to **legal entities** (`entities`) and, where needed, **facilities** (`facilities`), on the same org → entity → facility hierarchy as resident billing.

**Operator outcomes (Core):**

- Maintain a **chart of accounts** per legal entity.
- Record **journal entries** with balanced lines (debits = credits).
- View a **read-only ledger** (journal list + line detail) for audit and month-end review.
- Preserve **financial accountability**: audit log on all financial tables; money in **integer cents**; soft deletes.

**Non-goals (Core):** This module does **not** replace Module 16. Resident billing remains the system of record for invoices and payments until Enhanced/Future posting automation.

---

## Scope tiers

### Core (ship first; Slice 1 implementation)

- Tables: `gl_accounts`, `journal_entries`, `journal_entry_lines`.
- RLS: `owner`, `org_admin` (full read/write for journal workflow per rules below); `facility_admin` (**read-only** on GL data for the selected facility / entity scope).
- Triggers: `haven_set_updated_at` on mutable tables; `haven_capture_audit_log` on financial tables.
- Admin UI: chart of accounts list, journal entry create/edit (draft/post), **read-only** ledger view.
- **No** budgets, **no** automatic posting from `invoices` / `payments`. **Integration hooks** documented only (see § Module 16 relationship).

### Enhanced (later slices)

- **facility_admin** limited write (e.g. draft entries for facility-level events) with posting rules.
- **Budget** vs **actual** tables and variance UI.
- **Trial balance** / period close export.
- **Posting** from billing: batch or event-driven GL posting from Module 16 (see § Integration hooks).

### Future (explicitly not Core)

- ERP replacement (inventory, payroll GL, fixed assets).
- Multi-currency.
- Automated bank reconciliation feeds.

---

## Relationship to Module 16 (Resident Billing & Collections)

| Module 16 | This module (17) |
|-----------|------------------|
| `invoices.entity_id`, `payments.entity_id` | **Same** `entities` rows anchor GL; COA is per `entity_id`. |
| AR subledger (invoices, payments) | GL is the **general ledger**; Module 16 does **not** get GL columns in the first slice. |

**Integration hooks (documented; not implemented in Slice 1):**

1. **Future table (optional name):** `gl_posting_batches` or `journal_entries.source_type = 'invoice'` + `source_id` pointing to `invoices.id` — when Enhanced posting ships, posted invoices create **balanced** journal lines against configured revenue/receivable accounts.
2. **Future:** Payment receipt posts to cash/AR accounts.
3. **Slice 1:** `journal_entries` includes nullable `source_type` / `source_id` for forward compatibility (manual entries leave null).

**Constraint:** No trigger on `invoices` or `payments` in Slice 1.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- ENUM TYPES (add in migration if not present)
-- ============================================================
CREATE TYPE gl_account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

CREATE TYPE journal_entry_status AS ENUM ('draft', 'posted', 'voided');

-- ============================================================
-- CHART OF ACCOUNTS (per legal entity)
-- ============================================================
CREATE TABLE gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_id uuid NOT NULL REFERENCES entities(id),

  code text NOT NULL,                            -- e.g. "1010", "4000" — unique per entity (Slice 1: chart is entity-level only)
  name text NOT NULL,
  account_type gl_account_type NOT NULL,
  parent_account_id uuid REFERENCES gl_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  description text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_gl_accounts_code_unique
  ON gl_accounts (entity_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_gl_accounts_org_entity ON gl_accounts (organization_id, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_gl_accounts_entity ON gl_accounts (entity_id) WHERE deleted_at IS NULL;

-- ============================================================
-- JOURNAL ENTRIES (header)
-- ============================================================
CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_id uuid NOT NULL REFERENCES entities(id),
  facility_id uuid REFERENCES facilities(id), -- NULL = entity-level entry

  entry_date date NOT NULL,
  memo text,
  status journal_entry_status NOT NULL DEFAULT 'draft',

  posted_at timestamptz,
  posted_by uuid REFERENCES auth.users(id),

  -- Forward-compatible integration (Slice 1: manual only; no posting from billing)
  source_type text,                             -- NULL | 'manual' | 'adjustment' | future: 'invoice' | 'payment'
  source_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_journal_entries_org ON journal_entries (organization_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_journal_entries_entity ON journal_entries (entity_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_journal_entries_facility ON journal_entries (facility_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_journal_entries_status ON journal_entries (organization_id, status) WHERE deleted_at IS NULL;

-- ============================================================
-- JOURNAL ENTRY LINES (lines)
-- ============================================================
CREATE TABLE journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  gl_account_id uuid NOT NULL REFERENCES gl_accounts(id),

  line_number integer NOT NULL,
  description text,
  debit_cents integer NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents integer NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  CHECK (
    (debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0) OR (debit_cents = 0 AND credit_cents = 0)
  ),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_journal_lines_entry ON journal_entry_lines (journal_entry_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_journal_lines_account ON journal_entry_lines (gl_account_id) WHERE deleted_at IS NULL;

-- Application / constraint trigger: on INSERT/UPDATE of lines for a posted entry, enforce sum(debits) = sum(credits) per journal_entry_id.
-- Implement via CONSTRAINT TRIGGER or deferred validation in application layer for Slice 1; migration should add a CHECK trigger function after line changes.
```

**Business rules:**

- **Posting:** `status = 'posted'` only when `sum(debit_cents) = sum(credit_cents)` for all lines of that `journal_entry_id` (excluding soft-deleted lines).
- **Voided:** `status = 'voided'` — lines remain for audit; no further edits (enforce in app + RLS).
- **Money:** all amounts **integer cents**; no floats.

---

## RLS POLICIES (policy intent — translate to `haven.*` in migrations)

**Tables:** `gl_accounts`, `journal_entries`, `journal_entry_lines`.

**Roles:**

| Role | gl_accounts | journal_entries / lines |
|------|-------------|-------------------------|
| `owner`, `org_admin` | Full CRUD within `organization_id` | Full CRUD; may post |
| `facility_admin` | SELECT only; `entity_id` IN (SELECT `entity_id` FROM `facilities` WHERE `id` IN accessible facilities) | SELECT only; `journal_entries.facility_id` is null OR in accessible facilities |
| Others | No access | No access |

**Policy shape (illustrative SELECT for `journal_entries`):**

```sql
-- SELECT: same organization
organization_id = auth.organization_id()
AND deleted_at IS NULL
AND (
  auth.app_role() IN ('owner', 'org_admin')
  OR (
    auth.app_role() = 'facility_admin'
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT auth.accessible_facility_ids())
    )
  )
)
```

**INSERT/UPDATE/DELETE:** `owner` and `org_admin` only for Slice 1 write paths on GL tables. **facility_admin** policies: **SELECT only** (no INSERT/UPDATE/DELETE for Slice 1).

**journal_entry_lines:** policies follow parent `journal_entries` via `organization_id` and join to parent for facility scoping.

---

## Audit and updated_at

- `gl_accounts`, `journal_entries`, `journal_entry_lines`: `BEFORE UPDATE` → `haven_set_updated_at`; `AFTER INSERT/UPDATE/DELETE` → `haven_capture_audit_log` (same pattern as `027_billing_and_collections_audit_triggers.sql`).
- `audit_log` remains append-only; no user-facing DELETE on financial rows — use soft-delete (`deleted_at`) where applicable.

---

## Admin UI (routes)

Canonical routes (add to [FRONTEND-CONTRACT.md](FRONTEND-CONTRACT.md) when implementing):

| Route | Purpose |
|-------|---------|
| `/admin/finance` | Hub: links to COA, journal entries, ledger |
| `/admin/finance/chart-of-accounts` | List + create/edit **gl_accounts** (entity scoped) |
| `/admin/finance/journal-entries` | List journal entries (filter by date, status) |
| `/admin/finance/journal-entries/new` | Create draft + lines |
| `/admin/finance/journal-entries/[id]` | Edit draft (until posted) or view posted |
| `/admin/finance/ledger` | Read-only ledger: list of posted entries with line drill-down |

**Facility scoping:** use existing facility selector; `facility_id` on journal entries filters list when a facility is selected; `All facilities` shows aggregate for org_admin/owner.

**UI quality:** loading, empty, error states per [FRONTEND-CONTRACT.md](FRONTEND-CONTRACT.md) §5.

---

## Reporting surfaces (Core)

- **Ledger view:** chronological posted entries with debits/credits by account.
- **No** formal financial statements (P&L, balance sheet) in **Core** — optional summary cards on hub only if low effort (e.g. “posted entries this month” count).

---

## Acceptance criteria (Core / Slice 1)

1. Migration `040_*` creates enums, three tables, indexes, RLS enabled, audit/`updated_at` triggers.
2. **owner** / **org_admin** can create COA rows, create journal draft with ≥2 lines, balance debits/credits, then post.
3. **facility_admin** can **read** GL data for the selected facility scope (and entity-level rows with `facility_id` null) but **cannot** create or post journal entries in Slice 1.
4. Posted entries are immutable (no line edits after post; void flow can be Enhanced or manual reversal entry in Core — **Slice 1:** disallow editing posted entries in UI; void status reserved for future).
5. `npm run migrations:check` and `npm run migrations:verify:pg` pass.
6. Segment gate with `--ui` passes for new Admin routes.

---

## Seed / demo (optional)

- Oakridge demo entity: minimal COA (cash, AR, revenue, expense) — **optional** in Slice 1; can be empty until user creates accounts.

---

## Spec summary (for handoff)

**Entity & Facility Finance** adds a **per-entity chart of accounts** and **double-entry journal** with **read-only** ledger visibility for **facility_admin**, full journal workflow for **owner** / **org_admin**, strict **cents** and **audit**, and **documented** hooks to Module 16 without automatic posting in Slice 1.

**Exact Core scope:** `gl_accounts`, `journal_entries`, `journal_entry_lines`; RLS; triggers; admin routes in § Admin UI; no budgets; no invoice/payment posting.

**Recommended first implementation slice:** migration `040` + COA + journal CRUD + read-only ledger + facility_admin read-only; integration points documented in § Module 16 relationship.
