# 07A Level Engine Contract (TypeScript and SQL parity)

**Parent spec:** `docs/specs/07A-something-happened-capture.md` §2.1 and §3.
**Purpose:** one rule set, two runtimes (`src/lib/care-events/level-engine.ts` and `public.care_event_derive`), one fixture file (`src/lib/care-events/level-cases.json`). Every case in the fixture must produce byte-identical `level`, `derived_level`, `category`, `flags`, and `sentence` from both runtimes. This file is the tie-breaker when the two disagree.

## 1. Signature

TypeScript: `deriveCareEvent(kind, answers, context) => { level, derived_level, category, flags, sentence }`

SQL: `public.care_event_derive(p_kind text, p_answers jsonb, p_context jsonb) RETURNS jsonb` (`IMMUTABLE`, `LANGUAGE plpgsql`, no table reads) returning the same keys.

- `level` is an integer 1 to 4 **after** the reporter bump and clamp (the value stored as `final_level`).
- `derived_level` is the integer 1 to 4 **before** the reporter bump (stored as `derived_level`).
- `category` is an `incident_category` enum value as text.
- `flags` is an object with exactly these eight boolean keys, always present: `ahca_reportable`, `insurance_reportable`, `dcf_report_required`, `grievance_clock`, `neuro_checks`, `call_911_prompt`, `photo_prompt`, `emar_reminder`.
- `sentence` is the Section 1 factual sentence (§5 below).

Unknown kinds throw (TS) or `RAISE EXCEPTION` (SQL). Unknown or missing answer values are treated as "not answered" and apply no rule.

## 2. Kinds and answer keys

Answers are a flat JSON object. Single-select values are strings; multi-select values are arrays of strings. `worried` (boolean) is common to every kind and is the reporter bump.

| kind | key | values (in display order) |
|---|---|---|
| `fall` | `hurt` | `not_hurt`, `a_little`, `badly` |
| `fall` | `head` | `no`, `yes`, `not_sure` |
| `fall` | `witnessed` | `yes`, `no` |
| `fall` | `going_out` | `no`, `yes` |
| `injury_found` | `seen` (multi) | `bruise`, `skin_tear`, `burn`, `swelling_pain`, `other` |
| `injury_found` | `care` | `first_aid_enough`, `more_than_first_aid` |
| `injury_found` | `cause_known` | `yes`, `no` |
| `condition_change` | `signs` (multi) | `confused`, `weak_dizzy`, `fever_chills`, `vomiting_diarrhea`, `not_eating_drinking`, `pain`, `short_of_breath`, `chest_pain`, `stroke_signs`, `wont_wake` |
| `condition_change` | `onset` | `today`, `over_days` |
| `behavior` | `what` | `yelling`, `refusing_care`, `hitting`, `sexual`, `crying_withdrawn`, `self_harm` |
| `behavior` | `touched` | `no_one`, `another_resident`, `staff` |
| `behavior` | `over` | `yes`, `still_going` |
| `wandering` | `where` | `found_inside`, `found_grounds`, `found_off_property`, `not_found` |
| `wandering` | `hurt` | `no`, `yes` |
| `medication` | `what` | `refused`, `missed_late`, `wrong`, `not_theirs` |
| `medication` | `reaction` | `no`, `yes` |
| `family_complaint` | `what` | `family_upset`, `visitor_problem`, `resident_complaint`, `mistreated` |
| `environment` | `what` | `water_leak`, `smoke_fire`, `power_out`, `broken_equipment`, `missing_damaged`, `other` |
| `environment` | `danger` | `no`, `yes` |
| all | `worried` | `true` / `false` (absent = false) |

## 3. Context keys

`context` is a flat JSON object. Missing keys default to `false` / `null`.

| key | type | meaning |
|---|---|---|
| `active_watch` | boolean | resident has an active `resident_watch_instances` row |
| `elopement_risk` | boolean | `residents.elopement_risk` |
| `prior_unexplained_bruise_30d` | boolean | an `unexplained_bruise` care event or incident for this resident in the last 30 days |
| `location_label` | string or null | display label of the chosen location chip, e.g. `Resident Room` |
| `time_label` | string or null | occurred-at wall clock in the facility timezone, e.g. `10:05 PM` |

The engine never reads the database and never formats dates. Callers pass the labels.

## 4. Derivation (in this order, highest wins)

1. **Base level by kind:** fall 2, injury_found 1, condition_change 2, behavior 1, wandering 1, medication 1, family_complaint 1, environment 1.
2. **Answer rules** (`level = max(level, rule)` unless marked "raise", which is `level + 1`):
   - fall: `hurt=badly` → 4; `hurt=a_little` → 2; `head=yes|not_sure` → 3; `going_out=yes` → 4. (`witnessed` never changes the level; unwitnessed no-injury is already the floor of 2.)
   - injury_found: `care=more_than_first_aid` → 3; `cause_known=no` → 2.
   - condition_change: any of `short_of_breath`, `chest_pain`, `stroke_signs`, `wont_wake` in `signs` → 4; otherwise two or more selected signs → 3; otherwise one selected sign → 2. `onset` never changes the level.
   - behavior: `what=self_harm` → 3; `touched=another_resident` → 3; `touched=staff` → 2; `over=still_going` → 2. (`what=sexual` with `touched=another_resident` is 3 through the touched rule.)
   - wandering: `where=found_inside` → 1; `found_grounds` → 2; `found_off_property` → 3; `not_found` → 4; then `hurt=yes` **raise** +1.
   - medication: `what=refused` → 1; `missed_late` → 2; `wrong|not_theirs` → 3; `reaction=yes` → 4.
   - family_complaint: `what=mistreated` → 3; `resident_complaint` → 2; others 1.
   - environment: `what=smoke_fire` → 4; `water_leak|power_out` → 2; `broken_equipment|missing_damaged|other` → 1; `danger=yes` → 4.
3. **Resident context raises:** `active_watch` raises fall and condition_change by 1; `elopement_risk` raises wandering by 1; `prior_unexplained_bruise_30d` with injury_found `cause_known=no` and `bruise` in `seen` → `max(level, 3)`.
4. Clamp to 1..4. This is `derived_level`.
5. **Reporter bump:** `worried=true` → +1. Clamp to 1..4. This is `level`.

## 5. Category

| kind | category |
|---|---|
| fall | `fall_without_injury` when `hurt=not_hurt` or unanswered; otherwise `fall_with_injury` |
| injury_found | `unexplained_bruise` when `cause_known=no` and `bruise` in `seen`; otherwise `skin_integrity` when any of `bruise`, `skin_tear`, `burn`, `swelling_pain` in `seen`; otherwise `other` |
| condition_change | `other` |
| behavior | `behavioral_self_harm` when `what=self_harm`; otherwise `behavioral_resident_to_resident` when `touched=another_resident`; otherwise `behavioral_resident_to_staff` when `touched=staff`; otherwise `other` |
| wandering | `elopement` when `where` is `found_off_property` or `not_found`; otherwise `wandering` |
| medication | `medication_refusal` when `what=refused`; otherwise `medication_error` |
| family_complaint | `abuse_allegation` when `what=mistreated`; otherwise `other` |
| environment | `environmental_fire` for `smoke_fire`; `environmental_flood` for `water_leak`; `environmental_power` for `power_out`; `property_damage` for `broken_equipment`; `property_loss` for `missing_damaged`; otherwise `other` |

## 6. Flags (computed from the final `level` and the category)

| flag | true when |
|---|---|
| `ahca_reportable` | (level 4 and kind in (fall, condition_change)); or (kind wandering and `where=not_found`); or (kind medication and `reaction=yes`); or (kind environment and `danger=yes`); or category in (`abuse_allegation`, `neglect_allegation`); or (kind fall and `going_out=yes`). Mirrors parent spec §3: Level 4 alone qualifies only for Fall and Sick; Wandering, Medicine and Building need their own answer. |
| `insurance_reportable` | level 3 or 4; or category `elopement`; or category in (`abuse_allegation`, `neglect_allegation`) |
| `dcf_report_required` | category in (`abuse_allegation`, `neglect_allegation`) |
| `grievance_clock` | kind family_complaint and `what=resident_complaint` |
| `neuro_checks` | kind fall and `head` in (`yes`, `not_sure`) |
| `call_911_prompt` | level 4 and kind in (fall, condition_change, wandering, environment) |
| `photo_prompt` | kind injury_found and level 1 (known cause, first aid was enough) |
| `emar_reminder` | kind medication and `what=refused` |

## 7. Sentence

Sentences are built from fixed fragments joined by a single space. Every fragment ends with a period. `LOC` is `" in the " + lower(location_label)` when `location_label` is present, else empty. `TIME` is `" at " + time_label` when present, else empty. Unanswered questions contribute nothing. Multi-select lists join their labels with `", "` in display order; an empty multi-select contributes nothing.

Labels for list items: bruise "bruise", skin_tear "skin tear or cut", burn "burn", swelling_pain "swelling or pain", other "other"; confused "more confused than usual", weak_dizzy "weak or dizzy", fever_chills "fever or chills", vomiting_diarrhea "vomiting or diarrhea", not_eating_drinking "not eating or drinking", pain "pain", short_of_breath "short of breath", chest_pain "chest pain", stroke_signs "face droop, slurred speech, or one weak side", wont_wake "will not wake up or very hard to wake".

| kind | fragments in order |
|---|---|
| fall | `"Found on the floor" + LOC + TIME + "."`; witnessed yes "Witnessed." / no "Not witnessed."; hurt not_hurt "Not hurt." / a_little "Hurt a little." / badly "Hurt badly."; head no "Did not hit head." / yes "Hit head." / not_sure "Not sure if head was hit."; going_out no "Not going out." / yes "Going out to the ER or 911 called."; then hurt a_little "First aid given." / badly "Emergency care requested." |
| injury_found | `"Injury found" + LOC + TIME + "."`; `"Seen: " + list + "."`; care first_aid_enough "First aid was enough." / more_than_first_aid "Needs more than first aid."; cause_known yes "Cause known." / no "Cause unknown." |
| condition_change | `"Not themselves" + LOC + TIME + "."`; `"Signs: " + list + "."`; onset today "Came on today." / over_days "Getting worse over days." |
| behavior | `"Behavior" + LOC + TIME + "."`; what yelling "Yelling or cursing." / refusing_care "Refusing care." / hitting "Hitting, pushing, or grabbing." / sexual "Sexual behavior." / crying_withdrawn "Crying or withdrawn." / self_harm "Hurting themselves."; touched no_one "No one touched or hurt." / another_resident "Another resident touched or hurt." / staff "Staff touched or hurt."; over yes "It is over." / still_going "Still going." |
| wandering | `"Wandering" + LOC + TIME + "."`; where found_inside "Found inside." / found_grounds "Found outside on the grounds." / found_off_property "Found off the property." / not_found "Not found yet."; hurt no "Not hurt." / yes "Hurt." |
| medication | `"Medicine" + LOC + TIME + "."`; what refused "Refused." / missed_late "Missed or late." / wrong "Wrong medicine, dose, time, or person." / not_theirs "Took something not theirs."; reaction no "No reaction." / yes "Reaction or feeling bad." |
| family_complaint | `"Family or complaint" + LOC + TIME + "."`; what family_upset "Family upset or complaint." / visitor_problem "Visitor problem." / resident_complaint "Resident complaint about care." / mistreated "Someone may have been mistreated." |
| environment | `"Building" + LOC + TIME + "."`; what water_leak "Water leak or flood." / smoke_fire "Smoke, fire, or alarm." / power_out "Power out." / broken_equipment "Broken equipment." / missing_damaged "Something missing or damaged." / other "Other."; danger no "No one in danger." / yes "Someone in danger." |

Example (fall, a_little, head no, witnessed no, going_out no, Resident Room, 10:05 PM):
`Found on the floor in the resident room at 10:05 PM. Not witnessed. Hurt a little. Did not hit head. Not going out. First aid given.`

The staff voice note is **not** part of the sentence. `submit_care_event` appends it to `incidents.description` as `"\n\nStaff note: " + note`.

## 8. Fixture format (`level-cases.json`)

```json
[
  {
    "id": "fall_badly_going_out",
    "kind": "fall",
    "answers": { "hurt": "badly", "head": "no", "witnessed": "yes", "going_out": "yes" },
    "context": { "location_label": "Resident Room", "time_label": "10:05 PM" },
    "expect": {
      "level": 4,
      "derived_level": 4,
      "category": "fall_with_injury",
      "flags": { "ahca_reportable": true, "insurance_reportable": true, "dcf_report_required": false, "grievance_clock": false, "neuro_checks": false, "call_911_prompt": true, "photo_prompt": false, "emar_reminder": false },
      "sentence": "Found on the floor in the resident room at 10:05 PM. Witnessed. Hurt badly. Did not hit head. Going out to the ER or 911 called. Emergency care requested."
    }
  }
]
```

`ids` are unique snake_case. A case may carry `"unknown_answer_keys": ["hurt"]` to declare that it deliberately fills those keys with a value outside the §2 vocabulary (the vitest vocabulary check then requires the value to be unknown instead of registered); such cases pin the "not answered" behavior of both runtimes. The Playwright project reads this file to find the expected level word for the case it walks; the parity script `scripts/care-events/verify-level-parity.mjs` runs every case through `care_event_derive` and diffs against `expect`.

## 9. Level words

`formatLevelWord(level)` in `src/lib/incidents/incidents-display-copy.ts` accepts `1..4`, `"level_1".."level_4"`, or `"1".."4"` and returns `Note`, `Heads-up`, `Urgent`, `Emergency`. Anything else returns `"No level posted"`.
