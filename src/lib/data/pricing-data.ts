export interface PricingTier {
  id: string;
  name: string;
  monthlyBaseRate: number;
  description: string;
  squareFeet: string;
  features: string[];
}

export const BASE_ROOM_TIERS: PricingTier[] = [
  {
    id: "semi-private",
    name: "Semi-Private Companion Suite",
    monthlyBaseRate: 4000,
    description:
      "A spacious shared suite ideal for residents who enjoy companionship, conversation, and exceptional value.",
    squareFeet: "320 - 380 sq ft",
    features: [
      "Furnished or bring your own cherished furniture",
      "Private climate control & large sunlit window",
      "Step-free zero-threshold walk-in bathroom",
      "Emergency pull cords & 24/7 call pendant integration",
      "3 Chef-prepared meals & 2 daily snacks included",
      "Daily housekeeping, fresh linens & personal laundry",
    ],
  },
  {
    id: "private-suite",
    name: "Deluxe Private Suite",
    monthlyBaseRate: 5550,
    description:
      "A peaceful, private sanctuary offering complete independence, generous space, and serene courtyard or garden views.",
    squareFeet: "420 - 510 sq ft",
    features: [
      "Expansive private living & bedroom space",
      "En-suite private luxury bathroom with zero-barrier shower",
      "Large closet & personalized memory shadowbox entrance",
      "Individual temperature controls & premium cable/Wi-Fi",
      "All meals, snacks, utilities, and daily housekeeping included",
      "Priority reserved parking for visiting family members",
    ],
  },
];

export interface CareLevel {
  id: string;
  tier: string;
  name: string;
  monthlyFee: number;
  scoreRange: string;
  description: string;
  includedServices: string[];
}

export const CARE_LEVELS: CareLevel[] = [
  {
    id: "level-0",
    tier: "Level 0",
    name: "Independent Lifestyle & Wellness",
    monthlyFee: 0,
    scoreRange: "0 pts",
    description:
      "For self-sufficient residents who desire an active community, chef dining, and social events without hands-on physical assistance.",
    includedServices: [
      "All meals, housekeeping, linen and laundry service",
      "Life enrichment, music therapy, and daily activities",
      "24/7 on-site emergency security & wellness check-ins",
      "Scheduled medical transportation coordination",
    ],
  },
  {
    id: "level-1",
    tier: "Level 1",
    name: "Gentle Helping Hand (Mild ADL Support)",
    monthlyFee: 250,
    scoreRange: "1 - 12 pts",
    description:
      "For residents needing light daily assistance with morning dressing, medication supervision, or occasional reminders.",
    includedServices: [
      "Certified 24/7 Medication Administration (eMAR)",
      "Gentle standby assistance with bathing and dressing",
      "Morning and evening grooming prompts & check-ins",
      "Nutritional intake and hydration tracking",
    ],
  },
  {
    id: "level-2",
    tier: "Level 2",
    name: "Comprehensive Daily Care (Moderate Support)",
    monthlyFee: 500,
    scoreRange: "13 - 23 pts",
    description:
      "Hands-on daily support with bathing, dressing, grooming, safe mobility transfers, and structured routine maintenance.",
    includedServices: [
      "Full hands-on assistance with showering and personal hygiene",
      "1-person transfer and mobility escort to dining & events",
      "Complete medication management with pharmacy coordination",
      "Routine continence support and nighttime check rounds",
    ],
  },
  {
    id: "level-3",
    tier: "Level 3",
    name: "Full Attentive Care (High Acuity)",
    monthlyFee: 750,
    scoreRange: "24 - 30 pts",
    description:
      "Extensive daily physical care, continuous mobility assistance, advanced medication management, and frequent safety oversight.",
    includedServices: [
      "Complete assistance with all Activities of Daily Living",
      "Continuous mobility assistance & transfer support",
      "Comprehensive continence care management",
      "Frequent safety rounds and personalized comfort interventions",
    ],
  },
];

export interface FinancialOffset {
  id: string;
  name: string;
  monthlySavings: number;
  description: string;
  qualifyingDetails: string;
}

export const FINANCIAL_OFFSETS: FinancialOffset[] = [
  {
    id: "va-single",
    name: "VA Aid & Attendance (Single Veteran)",
    monthlySavings: 2431,
    description:
      "A tax-free monthly pension paid directly by the Veterans Administration to wartime veterans needing assisted living.",
    qualifyingDetails:
      "Must have served 90+ days active duty with at least 1 day during a recognized wartime period (WWII, Korea, Vietnam, Gulf War).",
  },
  {
    id: "va-married",
    name: "VA Aid & Attendance (Married Veteran)",
    monthlySavings: 3261,
    description:
      "Increased monthly tax-free benefit for married veterans who require daily assistance with living activities.",
    qualifyingDetails:
      "Combined veteran + spouse benefit that offsets the majority of assisted living monthly costs.",
  },
  {
    id: "va-survivor",
    name: "VA Aid & Attendance (Surviving Spouse)",
    monthlySavings: 1478,
    description:
      "Monthly benefit for the surviving spouse of a wartime veteran to support their long-term care needs.",
    qualifyingDetails:
      "Must have been married to the eligible wartime veteran at the time of their passing.",
  },
  {
    id: "ltc-insurance",
    name: "Long-Term Care (LTC) Insurance Policy",
    monthlySavings: 3000,
    description:
      "Most private long-term care insurance policies pay a daily benefit ($100 - $200/day) toward assisted living suites.",
    qualifyingDetails:
      "Our administrative office handles all monthly claim filings and nursing documentation directly with your insurer.",
  },
];

export const HOME_CARE_COST_COMPARISON = {
  mortgageOrRent: 1400,
  propertyTaxAndInsurance: 450,
  foodAndGroceries: 650,
  homeUtilitiesAndWifi: 380,
  homeMaintenanceAndLawn: 350,
  homeCaregiverHourlyRate: 28,
  homeCaregiverHoursPerWeek: 40,
  monthlyHomeCaregiverCost: 4850,
  totalTrueMonthlyCostAtHome: 8080,
};
