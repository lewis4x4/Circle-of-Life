# 03 — Resident Profile & Care Planning

**Dependencies:** 00-foundation (organizations, entities, facilities, rooms, beds, RBAC)
**Build Week:** 3-4 (core), 13-14 (advanced)

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- RESIDENTS (central entity — everything links to this)
-- ============================================================
CREATE TABLE residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  bed_id uuid REFERENCES beds(id),

  -- Demographics
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  date_of_birth date NOT NULL,
  gender gender NOT NULL,
  ssn_last_four text,                          -- only last 4, encrypted at rest
  photo_url text,

  -- Status
  status resident_status NOT NULL DEFAULT 'inquiry',
  acuity_level acuity_level,
  acuity_score numeric(5,2),                   -- composite numeric score

  -- Admission
  admission_date date,
  admission_source text,                       -- "hospital", "home", "another_alf", "skilled_nursing"
  referral_source_id uuid,                     -- FK to referral_sources (Module 1, Phase 4)

  -- Discharge
  discharge_date date,
  discharge_reason discharge_reason,
  discharge_destination text,
  discharge_notes text,

  -- Medical
  primary_physician_name text,
  primary_physician_phone text,
  primary_physician_fax text,
  primary_diagnosis text,
  diagnosis_list text[],                       -- ICD-10 codes or plain text
  allergy_list text[],
  diet_order text,                             -- "Regular", "Diabetic", "Mechanical Soft", "Pureed", "Thickened Liquids"
  diet_restrictions text[],
  code_status text NOT NULL DEFAULT 'full_code', -- "full_code", "dnr", "dnr_dni", "comfort_care"
  advance_directive_on_file boolean NOT NULL DEFAULT false,
  advance_directive_type text,                 -- "living_will", "healthcare_proxy", "both"

  -- Mobility & Safety
  ambulatory boolean NOT NULL DEFAULT true,
  assistive_device text,                       -- "walker", "wheelchair", "cane", "none"
  fall_risk_level text DEFAULT 'standard',     -- "low", "standard", "high"
  elopement_risk boolean NOT NULL DEFAULT false,
  wandering_risk boolean NOT NULL DEFAULT false,
  smoking_status text DEFAULT 'non_smoker',    -- "non_smoker", "former", "current_supervised"

  -- Billing
  primary_payer payer_type NOT NULL DEFAULT 'private_pay',
  secondary_payer payer_type,
  monthly_base_rate integer,                   -- cents
  monthly_care_surcharge integer DEFAULT 0,    -- cents, based on acuity
  monthly_total_rate integer,                  -- cents, computed
  rate_effective_date date,

  -- Contacts (primary responsible party inline for quick access)
  responsible_party_name text,
  responsible_party_relationship text,
  responsible_party_phone text,
  responsible_party_email text,
  responsible_party_address text,

  -- Emergency
  emergency_contact_1_name text,
  emergency_contact_1_relationship text,
  emergency_contact_1_phone text,
  emergency_contact_2_name text,
  emergency_contact_2_relationship text,
  emergency_contact_2_phone text,

  -- Preferences
  preferred_wake_time time,
  preferred_bed_time time,
  preferred_shower_days text[],                -- ["monday", "wednesday", "friday"]
  food_preferences text,
  activity_preferences text,
  religious_preference text,
  special_instructions text,

  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_residents_facility ON residents(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_residents_org ON residents(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_residents_status ON residents(facility_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_residents_bed ON residents(bed_id) WHERE deleted_at IS NULL AND bed_id IS NOT NULL;
CREATE INDEX idx_residents_name ON residents(last_name, first_name) WHERE deleted_at IS NULL;
CREATE INDEX idx_residents_acuity ON residents(facility_id, acuity_level) WHERE deleted_at IS NULL AND status = 'active';

-- Add FK from beds to residents now
ALTER TABLE beds ADD CONSTRAINT fk_beds_resident FOREIGN KEY (current_resident_id) REFERENCES residents(id);
-- Add FK from family_resident_links
ALTER TABLE family_resident_links ADD CONSTRAINT fk_frl_resident FOREIGN KEY (resident_id) REFERENCES residents(id);

-- ============================================================
-- CARE PLANS
-- ============================================================
CREATE TABLE care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  version integer NOT NULL DEFAULT 1,
  status care_plan_status NOT NULL DEFAULT 'draft',
  effective_date date NOT NULL,
  review_due_date date NOT NULL,               -- 30 days post-admission, then every 90 days
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  notes text,
  previous_version_id uuid REFERENCES care_plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_care_plans_resident ON care_plans(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_care_plans_status ON care_plans(resident_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_care_plans_review_due ON care_plans(review_due_date) WHERE status = 'active' AND deleted_at IS NULL;

-- ============================================================
-- CARE PLAN ITEMS (individual care needs within a plan)
-- ============================================================
CREATE TABLE care_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES care_plans(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  category care_plan_item_category NOT NULL,
  title text NOT NULL,                         -- "Bathing Assistance", "Fall Prevention", "Pain Management"
  description text NOT NULL,                   -- detailed care instruction
  assistance_level assistance_level NOT NULL,
  frequency text,                              -- "daily", "3x daily", "as needed", "every shift"
  specific_times time[],                       -- [07:00, 12:00, 18:00] if time-specific
  special_instructions text,
  goal text,                                   -- "Resident will maintain current mobility level"
  interventions text[],                        -- ["Assist with walker", "Ensure non-skid footwear", "Night light in room"]
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_cpi_care_plan ON care_plan_items(care_plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cpi_resident ON care_plan_items(resident_id) WHERE deleted_at IS NULL AND is_active = true;
CREATE INDEX idx_cpi_category ON care_plan_items(resident_id, category) WHERE deleted_at IS NULL AND is_active = true;

-- ============================================================
-- ASSESSMENTS (individual assessment instances)
-- ============================================================
CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  assessment_type text NOT NULL,               -- "katz_adl", "morse_fall", "braden", "phq9", "mmse", "weight", "vitals"
  assessment_date date NOT NULL,
  total_score numeric(8,2),
  risk_level text,                             -- "low", "moderate", "high" — interpretation of score
  scores jsonb NOT NULL DEFAULT '{}',          -- individual item scores: {"bathing": 1, "dressing": 0, ...}
  notes text,
  assessed_by uuid NOT NULL REFERENCES auth.users(id),
  next_due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_assessments_resident ON assessments(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assessments_type ON assessments(resident_id, assessment_type, assessment_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_assessments_due ON assessments(next_due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_assessments_facility_date ON assessments(facility_id, assessment_date DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- RESIDENT PHOTOS (skin integrity, identification, documentation)
-- ============================================================
CREATE TABLE resident_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  photo_type text NOT NULL,                    -- "identification", "skin_integrity", "wound", "bruise", "general"
  storage_path text NOT NULL,                  -- Supabase Storage path
  description text,
  anatomical_location text,                    -- "left_forearm", "sacrum", "right_shin", etc.
  wound_stage text,                            -- Braden wound staging if applicable
  taken_at timestamptz NOT NULL DEFAULT now(),
  taken_by uuid NOT NULL REFERENCES auth.users(id),
  linked_incident_id uuid,                     -- FK to incidents (Module 7)
  linked_assessment_id uuid REFERENCES assessments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_photos_resident ON resident_photos(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_photos_type ON resident_photos(resident_id, photo_type, taken_at DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- RESIDENT CONTACTS (beyond the inline responsible party)
-- ============================================================
CREATE TABLE resident_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_type text NOT NULL,                  -- "family", "physician", "pharmacy", "attorney", "case_manager", "hospice", "other"
  name text NOT NULL,
  relationship text,
  phone text,
  phone_alt text,
  email text,
  fax text,
  address text,
  is_emergency_contact boolean NOT NULL DEFAULT false,
  is_healthcare_proxy boolean NOT NULL DEFAULT false,
  is_power_of_attorney boolean NOT NULL DEFAULT false,
  notification_preference text DEFAULT 'phone', -- "phone", "email", "both"
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_contacts_resident ON resident_contacts(resident_id) WHERE deleted_at IS NULL;

-- ============================================================
-- RESIDENT DOCUMENTS (uploaded files — admission docs, advance directives, etc.)
-- ============================================================
CREATE TABLE resident_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  document_type text NOT NULL,                 -- "admission_agreement", "advance_directive", "dnr", "physician_order", "1823_assessment", "insurance_card", "id_card", "other"
  title text NOT NULL,
  storage_path text NOT NULL,
  file_type text,                              -- "pdf", "jpg", "png"
  file_size integer,                           -- bytes
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expiration_date date,                        -- for documents that expire (physician orders, insurance cards)
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_docs_resident ON resident_documents(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_docs_type ON resident_documents(resident_id, document_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_docs_expiration ON resident_documents(expiration_date) WHERE deleted_at IS NULL AND expiration_date IS NOT NULL;
```

---

## RLS POLICIES

```sql
-- RESIDENTS
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see residents in accessible facilities"
  ON residents FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND (
      -- Non-family: facility access check
      (auth.app_role() != 'family' AND facility_id IN (SELECT auth.accessible_facility_ids()))
      OR
      -- Family: only linked residents
      (auth.app_role() = 'family' AND auth.can_access_resident(id))
    )
  );

CREATE POLICY "Clinical staff can insert residents"
  ON residents FOR INSERT
  WITH CHECK (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY "Clinical staff can update residents"
  ON residents FOR UPDATE
  USING (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver')
  );

-- CARE PLANS
ALTER TABLE care_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see care plans in accessible facilities"
  ON care_plans FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

CREATE POLICY "Nurse+ can manage care plans"
  ON care_plans FOR ALL
  USING (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- CARE PLAN ITEMS
ALTER TABLE care_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see care plan items"
  ON care_plan_items FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

CREATE POLICY "Nurse+ can manage care plan items"
  ON care_plan_items FOR ALL
  USING (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- ASSESSMENTS
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see assessments"
  ON assessments FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

CREATE POLICY "Clinical staff can create assessments"
  ON assessments FOR INSERT
  WITH CHECK (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver')
  );

-- RESIDENT PHOTOS
ALTER TABLE resident_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical staff see photos"
  ON resident_photos FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() NOT IN ('family', 'dietary', 'maintenance_role')
  );

-- RESIDENT CONTACTS
ALTER TABLE resident_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see resident contacts"
  ON resident_contacts FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

-- RESIDENT DOCUMENTS
ALTER TABLE resident_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see resident documents"
  ON resident_documents FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() NOT IN ('dietary', 'maintenance_role')
  );

-- Apply audit triggers
CREATE TRIGGER audit_residents AFTER INSERT OR UPDATE OR DELETE ON residents FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_care_plans AFTER INSERT OR UPDATE OR DELETE ON care_plans FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_care_plan_items AFTER INSERT OR UPDATE OR DELETE ON care_plan_items FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_assessments AFTER INSERT OR UPDATE OR DELETE ON assessments FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON residents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON care_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON care_plan_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON resident_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Acuity Scoring

| Acuity Level | Katz ADL Score | Description | Typical Care Surcharge |
|-------------|----------------|-------------|----------------------|
| Level 1 | 0-2 | Minimal assistance. Independent in most ADLs. Needs reminders, supervision, or assistance with 1-2 ADLs. | $0 (base rate only) |
| Level 2 | 3-4 | Moderate assistance. Needs hands-on help with 3-4 ADLs. May need medication reminders. | +$500-$1,000/month |
| Level 3 | 5-6 | Extensive assistance. Needs help with most or all ADLs. Higher fall risk. May have behavioral needs. | +$1,000-$2,000/month |

**Rule:** When a Katz ADL assessment is completed, the system:
1. Calculates the total score (0-6, where 0 = independent in all, 6 = dependent in all)
2. Maps to acuity_level per the table above
3. IF acuity_level changed from the previous assessment:
   - Updates `residents.acuity_level` and `residents.acuity_score`
   - Generates a care plan review alert (care plan may need updating)
   - Generates a billing alert (rate may need adjusting)
   - Logs the change to the audit trail

### Katz ADL Index — Scoring Definition

Six activities, each scored 0 (independent) or 1 (dependent):

| Activity | Score 0 (Independent) | Score 1 (Dependent) |
|----------|----------------------|---------------------|
| Bathing | Bathes self completely or needs help with only one body part | Needs help bathing more than one body part or getting in/out of tub |
| Dressing | Gets clothes and dresses without assistance | Needs help getting dressed or stays partly undressed |
| Toileting | Goes to toilet, uses toilet, cleans self, arranges clothes without help | Needs help getting to toilet or cleaning self |
| Transferring | Moves in/out of bed and chair without assistance (may use mechanical aids) | Needs help moving from bed to chair or requires complete transfer |
| Continence | Controls bladder and bowel completely | Partial or total incontinence of bladder or bowel |
| Feeding | Feeds self without assistance | Needs partial or total help with feeding or requires parenteral feeding |

**Total Score: 0-6** (lower = more independent)

### Morse Fall Scale — Scoring Definition

| Factor | Score |
|--------|-------|
| History of falling (within 3 months) | No = 0, Yes = 25 |
| Secondary diagnosis (≥2 medical diagnoses) | No = 0, Yes = 15 |
| Ambulatory aid: None/bed rest/nurse assist = 0, Crutches/cane/walker = 15, Furniture = 30 | 0/15/30 |
| IV/heparin lock | No = 0, Yes = 20 |
| Gait: Normal/bed rest/wheelchair = 0, Weak = 10, Impaired = 20 | 0/10/20 |
| Mental status: Oriented to own ability = 0, Overestimates/forgets limitations = 15 | 0/15 |

**Total Score: 0-125**
- 0-24: Low risk → Standard fall precautions
- 25-44: Moderate risk → Implement fall prevention interventions
- ≥45: High risk → Implement high-risk fall prevention interventions

**Rule:** Maps to `residents.fall_risk_level`: 0-24 = "low", 25-44 = "standard", ≥45 = "high"

### Braden Scale — Scoring Definition

Six subscales, each scored 1-4 (lower = higher risk):

| Subscale | 1 | 2 | 3 | 4 |
|----------|---|---|---|---|
| Sensory Perception | Completely limited | Very limited | Slightly limited | No impairment |
| Moisture | Constantly moist | Very moist | Occasionally moist | Rarely moist |
| Activity | Bedfast | Chairfast | Walks occasionally | Walks frequently |
| Mobility | Completely immobile | Very limited | Slightly limited | No limitations |
| Nutrition | Very poor | Probably inadequate | Adequate | Excellent |
| Friction & Shear | Problem | Potential problem | No apparent problem | N/A (scored 1-3) |

**Total Score: 6-23**
- ≤9: Very high risk
- 10-12: High risk
- 13-14: Moderate risk
- 15-18: Mild risk
- ≥19: No risk

### PHQ-9 — Depression Screening

Nine questions, each scored 0-3:
- 0 = Not at all
- 1 = Several days
- 2 = More than half the days
- 3 = Nearly every day

**Total Score: 0-27**
- 0-4: Minimal depression
- 5-9: Mild depression
- 10-14: Moderate depression
- 15-19: Moderately severe depression
- 20-27: Severe depression

**Rule:** PHQ-9 score ≥10 → generate alert to nurse and care plan review recommendation.

### Care Plan Review Schedule

| Trigger | Review Due |
|---------|-----------|
| New admission | 30 days from admission date |
| Quarterly review | 90 days from last review |
| Acuity level change | Within 7 days of assessment |
| Hospital return | Within 72 hours of return |
| Significant change of condition | Within 48 hours of documented change |
| Fall with injury | Within 24 hours |
| Family/responsible party request | Within 7 days |

**Rule:** When `care_plans.review_due_date` is within 14 days, generate alert to assigned nurse. When overdue, generate alert to facility_admin.

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/residents` | Required | Staff (not family) | List residents in accessible facilities. Query params: `facility_id`, `status`, `acuity_level`, `search` (name) |
| GET | `/residents/:id` | Required | Staff + linked family | Get resident full profile |
| POST | `/residents` | Required | owner, org_admin, facility_admin, nurse | Create new resident |
| PUT | `/residents/:id` | Required | owner, org_admin, facility_admin, nurse, caregiver | Update resident |
| GET | `/residents/:id/care-plan` | Required | Staff + linked family (limited view) | Get active care plan with items |
| POST | `/residents/:id/care-plan` | Required | owner, org_admin, facility_admin, nurse | Create new care plan version |
| PUT | `/care-plans/:id` | Required | owner, org_admin, facility_admin, nurse | Update care plan |
| POST | `/care-plans/:id/items` | Required | owner, org_admin, facility_admin, nurse | Add care plan item |
| PUT | `/care-plan-items/:id` | Required | owner, org_admin, facility_admin, nurse | Update care plan item |
| POST | `/care-plans/:id/review` | Required | nurse, facility_admin | Mark care plan as reviewed |
| POST | `/care-plans/:id/approve` | Required | nurse, facility_admin | Approve care plan |
| GET | `/residents/:id/assessments` | Required | Staff | List assessments. Query params: `type`, `date_from`, `date_to` |
| POST | `/residents/:id/assessments` | Required | nurse, caregiver, facility_admin | Create assessment |
| GET | `/residents/:id/photos` | Required | Clinical staff | List photos |
| POST | `/residents/:id/photos` | Required | nurse, caregiver | Upload photo |
| GET | `/residents/:id/contacts` | Required | Staff | List contacts |
| POST | `/residents/:id/contacts` | Required | nurse, facility_admin | Add contact |
| PUT | `/resident-contacts/:id` | Required | nurse, facility_admin | Update contact |
| GET | `/residents/:id/documents` | Required | Staff (not dietary/maintenance) | List documents |
| POST | `/residents/:id/documents` | Required | nurse, facility_admin | Upload document |
| GET | `/assessments/overdue` | Required | nurse, facility_admin | List overdue assessments across facility |
| GET | `/care-plans/reviews-due` | Required | nurse, facility_admin | List care plans with reviews due within 14 days |

### Resident List Response Shape
```json
{
  "data": [
    {
      "id": "uuid",
      "first_name": "Margaret",
      "last_name": "Johnson",
      "preferred_name": "Maggie",
      "date_of_birth": "1938-05-12",
      "age": 87,
      "gender": "female",
      "status": "active",
      "acuity_level": "level_2",
      "room_number": "114",
      "bed_label": "A",
      "unit_name": "East Wing",
      "primary_payer": "private_pay",
      "fall_risk_level": "high",
      "elopement_risk": false,
      "admission_date": "2023-01-15",
      "photo_url": "/storage/residents/uuid/photo.jpg",
      "care_plan_review_due": "2026-04-15",
      "care_plan_overdue": false
    }
  ],
  "total": 49,
  "facility_id": "uuid"
}
```

### Care Plan Response Shape
```json
{
  "id": "uuid",
  "resident_id": "uuid",
  "version": 3,
  "status": "active",
  "effective_date": "2026-01-15",
  "review_due_date": "2026-04-15",
  "reviewed_at": "2026-01-15T10:00:00Z",
  "reviewed_by": {
    "id": "uuid",
    "full_name": "Sarah Williams, RN"
  },
  "items": [
    {
      "id": "uuid",
      "category": "mobility",
      "title": "Ambulation Assistance",
      "description": "Resident requires contact guard assist for ambulation with rolling walker. Ensure non-skid footwear at all times. Night light in room and bathroom.",
      "assistance_level": "limited_assist",
      "frequency": "As needed, minimum 3x daily (to meals)",
      "interventions": [
        "Contact guard assist with rolling walker",
        "Ensure non-skid footwear",
        "Night light in room and bathroom",
        "Call light within reach at all times"
      ],
      "goal": "Resident will maintain current ambulation ability and remain free from falls.",
      "is_active": true
    }
  ],
  "previous_version_id": "uuid"
}
```

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `assessment-scored` | INSERT on assessments | Evaluates score against thresholds. Updates resident acuity/fall risk if applicable. Generates alerts if needed. Calculates next_due_date. |
| `care-plan-review-check` | Cron (daily at 6 AM ET) | Scans care_plans where review_due_date is within 14 days or overdue. Generates alerts per the schedule above. |
| `care-plan-versioned` | UPDATE on care_plans when status changes to 'active' | Archives previous active version. Updates review_due_date. Regenerates caregiver task lists for affected resident. |
| `resident-status-changed` | UPDATE on residents when status changes | If status → 'hospital_hold': start bed hold tracking, notify family. If status → 'discharged' or 'deceased': trigger discharge workflow. If status → 'active' from 'hospital_hold': trigger readmission assessment. |
| `acuity-changed` | UPDATE on residents when acuity_level changes | Generate billing rate review alert. Generate care plan review alert. Update census dashboard cache. |

---

## SEED DATA — ASSESSMENT TEMPLATES

```sql
CREATE TABLE assessment_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_type text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  score_range_min numeric(8,2),
  score_range_max numeric(8,2),
  risk_thresholds jsonb NOT NULL,              -- {"low": [0, 24], "moderate": [25, 44], "high": [45, 125]}
  items jsonb NOT NULL,                        -- array of assessment items with scoring criteria
  default_frequency_days integer NOT NULL,     -- how often this assessment should be repeated
  required_role app_role[] NOT NULL,           -- which roles can administer this assessment
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO assessment_templates (assessment_type, name, description, score_range_min, score_range_max, risk_thresholds, items, default_frequency_days, required_role) VALUES
('katz_adl', 'Katz Index of Independence in ADLs', 'Measures functional status across 6 ADL categories', 0, 6,
  '{"level_1": [0, 2], "level_2": [3, 4], "level_3": [5, 6]}',
  '[{"key": "bathing", "label": "Bathing", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]},
    {"key": "dressing", "label": "Dressing", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]},
    {"key": "toileting", "label": "Toileting", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]},
    {"key": "transferring", "label": "Transferring", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]},
    {"key": "continence", "label": "Continence", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]},
    {"key": "feeding", "label": "Feeding", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]}]',
  90, ARRAY['nurse', 'caregiver', 'facility_admin']::app_role[]),

('morse_fall', 'Morse Fall Scale', 'Assesses fall risk based on 6 factors', 0, 125,
  '{"low": [0, 24], "standard": [25, 44], "high": [45, 125]}',
  '[{"key": "history_of_falling", "label": "History of Falling (past 3 months)", "options": [{"value": 0, "label": "No"}, {"value": 25, "label": "Yes"}]},
    {"key": "secondary_diagnosis", "label": "Secondary Diagnosis (≥2 diagnoses)", "options": [{"value": 0, "label": "No"}, {"value": 15, "label": "Yes"}]},
    {"key": "ambulatory_aid", "label": "Ambulatory Aid", "options": [{"value": 0, "label": "None/Bed rest/Nurse assist"}, {"value": 15, "label": "Crutches/Cane/Walker"}, {"value": 30, "label": "Furniture"}]},
    {"key": "iv_heparin", "label": "IV/Heparin Lock", "options": [{"value": 0, "label": "No"}, {"value": 20, "label": "Yes"}]},
    {"key": "gait", "label": "Gait", "options": [{"value": 0, "label": "Normal/Bed rest/Wheelchair"}, {"value": 10, "label": "Weak"}, {"value": 20, "label": "Impaired"}]},
    {"key": "mental_status", "label": "Mental Status", "options": [{"value": 0, "label": "Oriented to own ability"}, {"value": 15, "label": "Overestimates/Forgets limitations"}]}]',
  90, ARRAY['nurse', 'caregiver', 'facility_admin']::app_role[]),

('braden', 'Braden Scale for Predicting Pressure Sore Risk', 'Assesses risk for pressure injuries across 6 subscales', 6, 23,
  '{"very_high": [6, 9], "high": [10, 12], "moderate": [13, 14], "mild": [15, 18], "none": [19, 23]}',
  '[{"key": "sensory_perception", "label": "Sensory Perception", "options": [{"value": 1, "label": "Completely Limited"}, {"value": 2, "label": "Very Limited"}, {"value": 3, "label": "Slightly Limited"}, {"value": 4, "label": "No Impairment"}]},
    {"key": "moisture", "label": "Moisture", "options": [{"value": 1, "label": "Constantly Moist"}, {"value": 2, "label": "Very Moist"}, {"value": 3, "label": "Occasionally Moist"}, {"value": 4, "label": "Rarely Moist"}]},
    {"key": "activity", "label": "Activity", "options": [{"value": 1, "label": "Bedfast"}, {"value": 2, "label": "Chairfast"}, {"value": 3, "label": "Walks Occasionally"}, {"value": 4, "label": "Walks Frequently"}]},
    {"key": "mobility", "label": "Mobility", "options": [{"value": 1, "label": "Completely Immobile"}, {"value": 2, "label": "Very Limited"}, {"value": 3, "label": "Slightly Limited"}, {"value": 4, "label": "No Limitations"}]},
    {"key": "nutrition", "label": "Nutrition", "options": [{"value": 1, "label": "Very Poor"}, {"value": 2, "label": "Probably Inadequate"}, {"value": 3, "label": "Adequate"}, {"value": 4, "label": "Excellent"}]},
    {"key": "friction_shear", "label": "Friction & Shear", "options": [{"value": 1, "label": "Problem"}, {"value": 2, "label": "Potential Problem"}, {"value": 3, "label": "No Apparent Problem"}]}]',
  90, ARRAY['nurse', 'facility_admin']::app_role[]),

('phq9', 'PHQ-9 Patient Health Questionnaire', 'Depression screening tool', 0, 27,
  '{"minimal": [0, 4], "mild": [5, 9], "moderate": [10, 14], "moderately_severe": [15, 19], "severe": [20, 27]}',
  '[{"key": "interest", "label": "Little interest or pleasure in doing things", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "depressed", "label": "Feeling down, depressed, or hopeless", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "sleep", "label": "Trouble falling/staying asleep, or sleeping too much", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "energy", "label": "Feeling tired or having little energy", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "appetite", "label": "Poor appetite or overeating", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "failure", "label": "Feeling bad about yourself or that you are a failure", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "concentration", "label": "Trouble concentrating on things", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "movement", "label": "Moving or speaking slowly, or being fidgety/restless", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]},
    {"key": "self_harm", "label": "Thoughts that you would be better off dead or of hurting yourself", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}]',
  180, ARRAY['nurse', 'facility_admin']::app_role[]);
```

---

## UI SCREENS

Route and shell conventions follow `docs/specs/FRONTEND-CONTRACT.md`.

### Web (Admin/Nurse Dashboard)

| Screen | Route | Components | Data |
|--------|-------|-----------|------|
| Resident List | `/admin/residents` | Search bar, filter dropdowns (status, acuity, unit), sortable table, quick-view cards | GET /residents?facility_id=X |
| Resident Profile | `/admin/residents/:id` | Tab navigation: Overview, Care Plan, Assessments, Medications (Module 6), Daily Logs (Module 4), Incidents (Module 7), Photos, Documents, Contacts, Billing (Module 16) | GET /residents/:id |
| Care Plan Editor | `/admin/residents/:id/care-plan` | Drag-sortable care plan items, inline editing, version history sidebar, review/approve buttons | GET /residents/:id/care-plan |
| Assessment Entry | `/admin/residents/:id/assessments/new/:type` | Guided form matching assessment_template, auto-scoring, risk level display, save + alert generation | POST /residents/:id/assessments |
| Assessment History | `/admin/residents/:id/assessments` | Timeline view, score trending chart, filter by type | GET /residents/:id/assessments |
| Overdue Assessments | `/admin/assessments/overdue` | Table: resident, assessment type, due date, days overdue, assigned nurse | GET /assessments/overdue |
| Care Plan Reviews Due | `/admin/care-plans/reviews-due` | Table: resident, care plan version, review due date, days remaining/overdue | GET /care-plans/reviews-due |

### Mobile (Caregiver Interface)

| Screen | Route | Components | Data |
|--------|-------|-----------|------|
| My Residents | `/caregiver/residents` | Card list of assigned residents with: name, photo, room, acuity badge, key care plan highlights, pending tasks | GET /residents?assigned_to=me |
| Resident Quick View | `/caregiver/resident/:id` | Key info card: name, photo, room, allergies, diet, code status, fall risk, assistive device, key care plan items. One-tap to daily log, incident report, or full profile | GET /residents/:id (subset) |
| Assessment Entry | `/caregiver/resident/:id/assess/:type` | Step-through form optimized for mobile touch, large tap targets, auto-scoring | POST /residents/:id/assessments |
| Photo Capture | `/caregiver/resident/:id/photo` | Camera capture, body diagram for anatomical location tagging, description field, link to incident | POST /residents/:id/photos |

### Offline Behavior

| Operation | Offline Support | Sync Strategy |
|-----------|----------------|---------------|
| View resident list | Yes (cached from last sync) | Background refresh when online |
| View resident profile | Yes (cached) | Background refresh |
| View care plan | Yes (cached) | Background refresh |
| Create assessment | Yes (queued) | Submit on reconnect, timestamp preserved from entry time |
| Take photo | Yes (stored locally) | Upload on reconnect |
| View overdue assessments | No (requires server query) | Show "offline" indicator |
