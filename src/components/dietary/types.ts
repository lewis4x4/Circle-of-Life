// ── Dietary Command Deck shared types ─────────────────────────────

export type DietType =
  | "regular"
  | "mechanical_soft"
  | "puree"
  | "full_liquid"
  | "clear_liquid"
  | "ncs"
  | "low_sodium"
  | "renal"
  | "gluten_free"
  | "lactose_free"
  | "vegetarian"
  | "vegan"
  | "custom";

export type TicketStatus =
  | "queued"
  | "prepping"
  | "plating"
  | "plated"
  | "passed"
  | "delivered"
  | "refused"
  | "wasted"
  | "npo"
  | "hospital";

export type VenueId = "main_dining" | "memory_care" | "room_trays";

export type MealPeriod =
  | "breakfast"
  | "lunch"
  | "dinner"
  | "snack_am"
  | "snack_pm"
  | "snack_hs";

export type ServiceStatus = "planned" | "prep" | "plating" | "service" | "closed";

export interface MealService {
  id: string;
  venue: VenueId;
  meal_period: MealPeriod;
  scheduled_start: string;
  status: ServiceStatus;
  expected_count: number;
  served_count: number;
}

export interface TrayTicket {
  id: string;
  venue: VenueId;
  meal_service_id: string;
  resident_id: string;
  resident_name: string;   // "Sullivan, Margaret"
  room: string;
  diet_type: DietType;
  diet_label: string;      // human-readable, e.g. "Renal" / "NCS · 60g"
  iddsi_level: number;
  allergens: string[];
  status: TicketStatus;
  menu_items: string[];
  fortify: boolean;
  fortification_items: string[];
  carb_count_g: number | null;
  sodium_mg: number | null;
  calorie_count: number | null;
}

export interface HACCPEntry {
  id: string;
  time: string;            // formatted HH:MM
  item: string;
  temperature_f: number;
  in_safe_range: boolean;
  logged_by: string;       // first name only
  log_type: string;
}

export interface FortificationRec {
  id: string;
  resident_id: string;
  resident_name: string;
  room: string;
  diet_type: string;
  trigger: string;         // e.g. "−6.2% / 30d"
  add: string;             // e.g. "Boost Plus + butter pat"
  cal: string;             // e.g. "+340"
  status: "pending" | "accepted" | "declined" | "superseded";
}

export interface NPOResident {
  resident_id: string;
  name: string;
  room: string;
  reason: string;
  until: string;
}

export interface RefusalEntry {
  resident_id: string;
  name: string;
  room: string;
  item: string;
  suggest: string;
  at: string;
}

export interface ServiceBarData {
  cook_name: string;
  cook_initials: string;
  facility_name: string;
  meal_period: string;
  scheduled_time: string;
  countdown_min: number;
  expected: number;
  plated: number;
  passed: number;
  census_delta: Record<string, number>;
}

export interface DietaryDeckState {
  services: MealService[];
  tickets: TrayTicket[];
  haccp: HACCPEntry[];
  fortification: FortificationRec[];
  npo: NPOResident[];
  refusals: RefusalEntry[];
  service_bar: ServiceBarData;
  loading: boolean;
  error: string | null;
}
