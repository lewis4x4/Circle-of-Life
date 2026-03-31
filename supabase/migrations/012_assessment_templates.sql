-- Assessment templates + seed (spec 03-resident-profile)

CREATE TABLE assessment_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_type text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  score_range_min numeric(8, 2),
  score_range_max numeric(8, 2),
  risk_thresholds jsonb NOT NULL,
  items jsonb NOT NULL,
  default_frequency_days integer NOT NULL,
  required_role app_role[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO assessment_templates (assessment_type, name, description, score_range_min, score_range_max, risk_thresholds, items, default_frequency_days, required_role)
VALUES (
  'katz_adl',
  'Katz Index of Independence in ADLs',
  'Measures functional status across 6 ADL categories',
  0,
  6,
  '{"level_1": [0, 2], "level_2": [3, 4], "level_3": [5, 6]}'::jsonb,
  $katz$[{"key": "bathing", "label": "Bathing", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]}, {"key": "dressing", "label": "Dressing", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]}, {"key": "toileting", "label": "Toileting", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]}, {"key": "transferring", "label": "Transferring", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]}, {"key": "continence", "label": "Continence", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]}, {"key": "feeding", "label": "Feeding", "options": [{"value": 0, "label": "Independent"}, {"value": 1, "label": "Dependent"}]}]$katz$::jsonb,
  90,
  ARRAY['nurse', 'caregiver', 'facility_admin']::app_role[]
);

INSERT INTO assessment_templates (assessment_type, name, description, score_range_min, score_range_max, risk_thresholds, items, default_frequency_days, required_role)
VALUES (
  'morse_fall',
  'Morse Fall Scale',
  'Assesses fall risk based on 6 factors',
  0,
  125,
  '{"low": [0, 24], "standard": [25, 44], "high": [45, 125]}'::jsonb,
  $morse$[{"key": "history_of_falling", "label": "History of Falling (past 3 months)", "options": [{"value": 0, "label": "No"}, {"value": 25, "label": "Yes"}]}, {"key": "secondary_diagnosis", "label": "Secondary Diagnosis (>=2 diagnoses)", "options": [{"value": 0, "label": "No"}, {"value": 15, "label": "Yes"}]}, {"key": "ambulatory_aid", "label": "Ambulatory Aid", "options": [{"value": 0, "label": "None/Bed rest/Nurse assist"}, {"value": 15, "label": "Crutches/Cane/Walker"}, {"value": 30, "label": "Furniture"}]}, {"key": "iv_heparin", "label": "IV/Heparin Lock", "options": [{"value": 0, "label": "No"}, {"value": 20, "label": "Yes"}]}, {"key": "gait", "label": "Gait", "options": [{"value": 0, "label": "Normal/Bed rest/Wheelchair"}, {"value": 10, "label": "Weak"}, {"value": 20, "label": "Impaired"}]}, {"key": "mental_status", "label": "Mental Status", "options": [{"value": 0, "label": "Oriented to own ability"}, {"value": 15, "label": "Overestimates/Forgets limitations"}]}]$morse$::jsonb,
  90,
  ARRAY['nurse', 'caregiver', 'facility_admin']::app_role[]
);

INSERT INTO assessment_templates (assessment_type, name, description, score_range_min, score_range_max, risk_thresholds, items, default_frequency_days, required_role)
VALUES (
  'braden',
  'Braden Scale for Predicting Pressure Sore Risk',
  'Assesses risk for pressure injuries across 6 subscales',
  6,
  23,
  '{"very_high": [6, 9], "high": [10, 12], "moderate": [13, 14], "mild": [15, 18], "none": [19, 23]}'::jsonb,
  $braden$[{"key": "sensory_perception", "label": "Sensory Perception", "options": [{"value": 1, "label": "Completely Limited"}, {"value": 2, "label": "Very Limited"}, {"value": 3, "label": "Slightly Limited"}, {"value": 4, "label": "No Impairment"}]}, {"key": "moisture", "label": "Moisture", "options": [{"value": 1, "label": "Constantly Moist"}, {"value": 2, "label": "Very Moist"}, {"value": 3, "label": "Occasionally Moist"}, {"value": 4, "label": "Rarely Moist"}]}, {"key": "activity", "label": "Activity", "options": [{"value": 1, "label": "Bedfast"}, {"value": 2, "label": "Chairfast"}, {"value": 3, "label": "Walks Occasionally"}, {"value": 4, "label": "Walks Frequently"}]}, {"key": "mobility", "label": "Mobility", "options": [{"value": 1, "label": "Completely Immobile"}, {"value": 2, "label": "Very Limited"}, {"value": 3, "label": "Slightly Limited"}, {"value": 4, "label": "No Limitations"}]}, {"key": "nutrition", "label": "Nutrition", "options": [{"value": 1, "label": "Very Poor"}, {"value": 2, "label": "Probably Inadequate"}, {"value": 3, "label": "Adequate"}, {"value": 4, "label": "Excellent"}]}, {"key": "friction_shear", "label": "Friction & Shear", "options": [{"value": 1, "label": "Problem"}, {"value": 2, "label": "Potential Problem"}, {"value": 3, "label": "No Apparent Problem"}]}]$braden$::jsonb,
  90,
  ARRAY['nurse', 'facility_admin']::app_role[]
);

INSERT INTO assessment_templates (assessment_type, name, description, score_range_min, score_range_max, risk_thresholds, items, default_frequency_days, required_role)
VALUES (
  'phq9',
  'PHQ-9 Patient Health Questionnaire',
  'Depression screening tool',
  0,
  27,
  '{"minimal": [0, 4], "mild": [5, 9], "moderate": [10, 14], "moderately_severe": [15, 19], "severe": [20, 27]}'::jsonb,
  $phq9$[{"key": "interest", "label": "Little interest or pleasure in doing things", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "depressed", "label": "Feeling down, depressed, or hopeless", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "sleep", "label": "Trouble falling/staying asleep, or sleeping too much", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "energy", "label": "Feeling tired or having little energy", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "appetite", "label": "Poor appetite or overeating", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "failure", "label": "Feeling bad about yourself or that you are a failure", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "concentration", "label": "Trouble concentrating on things", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "movement", "label": "Moving or speaking slowly, or being fidgety/restless", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"key": "self_harm", "label": "Thoughts that you would be better off dead or of hurting yourself", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}]$phq9$::jsonb,
  180,
  ARRAY['nurse', 'facility_admin']::app_role[]
);
