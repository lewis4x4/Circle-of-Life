export interface Facility {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  legalEntity: string;
  licenseNumber: string;
  licenseType: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    county: string;
  };
  phone: string;
  email: string;
  administrator: {
    name: string;
    title: string;
    phone: string;
    email: string;
    bio: string;
  };
  licensedBeds: number;
  occupancyPct: number;
  availableBeds: number;
  pricing: {
    semiPrivate: number;
    privateSuite: number;
  };
  highlights: string[];
  features: string[];
  nearbyHealthcare: {
    facility: string;
    distance: string;
    type: string;
  }[];
  pharmacyPartner: string;
  powerBackup: string;
  heroDescription: string;
  atmosphere: string;
  diningSpecialty: string;
  image: string;
  bgGradient: string;
}

export const FACILITIES: Facility[] = [
  {
    id: "plantation",
    slug: "plantation-summers-lake-city",
    name: "The Plantation on Summers",
    tagline: "Premier Southern Estate Living with 24/7 Compassionate Care",
    legalEntity: "The Plantation on Summers, LLC",
    licenseNumber: "AL12480",
    licenseType: "Standard ALF",
    address: {
      street: "1478 W Summers Lane",
      city: "Lake City",
      state: "FL",
      zip: "32025",
      county: "Columbia County",
    },
    phone: "386-758-2020",
    email: "admin@theplantationonsummers.com",
    administrator: {
      name: "Bobbi Jo Hare",
      title: "Executive Director",
      phone: "386-758-2020",
      email: "bobbi@theplantationonsummers.com",
      bio: "Dedicated senior living director with over 15 years serving Columbia County families with Southern warmth and clinical excellence.",
    },
    licensedBeds: 64,
    occupancyPct: 98,
    availableBeds: 2,
    pricing: {
      semiPrivate: 4000,
      privateSuite: 5550,
    },
    highlights: [
      "Our largest & most sought-after North Florida campus (64 licensed beds)",
      "Sprawling estate grounds with grand magnolia trees and wide shaded verandas",
      "Private and semi-private luxury suites with step-free roll-in showers",
      "Close proximity to Lake City Medical Center & Lake City VA Hospital",
    ],
    features: [
      "24/7 Certified Caregiver & Medication Team",
      "Three Southern Home-Style Meals Daily + Snacks",
      "On-Site Beauty & Barber Salon",
      "Screened Verandas & Sunlit Courtyards",
      "Transportation to Local Appointments & Church",
      "Dual-Fuel Commercial Emergency Backup Power",
    ],
    nearbyHealthcare: [
      { facility: "Lake City Medical Center (HCA)", distance: "7 minutes", type: "Full Acute Hospital & ER" },
      { facility: "Lake City VA Medical Center", distance: "10 minutes", type: "Veteran Specialty & Primary Care" },
      { facility: "North Florida Pharmacy", distance: "5 minutes", type: "Daily Synchronized Medication Delivery" },
    ],
    pharmacyPartner: "North Florida Pharmacy (Lake City)",
    powerBackup: "Commercial On-Site LP Generator with Automatic Transfer",
    heroDescription:
      "Nestled among towering pines and magnolia trees in Lake City, The Plantation on Summers offers an exquisite estate setting where southern elegance meets 24-hour attentive, dignified care.",
    atmosphere: "Sprawling Southern Country Estate with grand verandas and peaceful manicured gardens.",
    diningSpecialty: "Slow-roasted beef pot roast with sweet baby carrots, skillet cornbread, and fresh blackberry cobbler.",
    image: "https://images.unsplash.com/photo-1544027993-37dbfe43562a?auto=format&fit=crop&w=1200&q=80",
    bgGradient: "from-amber-900/40 via-stone-900/60 to-stone-950",
  },
  {
    id: "grande-cypress",
    slug: "grande-cypress-lake-city",
    name: "Grande Cypress Assisted Living",
    tagline: "Serene Cypress Groves & Sunlit Comfort in Lake City",
    legalEntity: "Grande Cypress ALF, LLC",
    licenseNumber: "AL13421",
    licenseType: "Standard ALF",
    address: {
      street: "970 SW Pinemount Road",
      city: "Lake City",
      state: "FL",
      zip: "32024",
      county: "Columbia County",
    },
    phone: "386-287-5551",
    email: "aa.grandecypress@gmail.com",
    administrator: {
      name: "Jennifer Smith",
      title: "Executive Director",
      phone: "386-287-5551",
      email: "jennifer@grandecypressalf.com",
      bio: "Passionate about creating a family atmosphere where every resident feels valued, heard, and cherished every day.",
    },
    licensedBeds: 54,
    occupancyPct: 80,
    availableBeds: 6,
    pricing: {
      semiPrivate: 4000,
      privateSuite: 5550,
    },
    highlights: [
      "Modern single-story residential architecture designed for easy mobility",
      "Lush lakeside and cypress grove views with peaceful outdoor seating",
      "Immediate move-in availability in select deluxe private suites",
      "Active daily activity calendar with gardening, crafts, and musical guests",
    ],
    features: [
      "24/7 Attentive Caregiver Staffing",
      "Medication Management & Pharmacy Sync",
      "High-Ceiling Sunrooms & Activity Parlors",
      "Zero-Threshold Roll-In Tile Bathrooms",
      "Scheduled Outings & Scenic Suwannee Country Drives",
      "Full Commercial Generator Emergency System",
    ],
    nearbyHealthcare: [
      { facility: "Lake City Medical Center", distance: "6 minutes", type: "Full Hospital & Emergency Care" },
      { facility: "Columbia County Health Clinic", distance: "8 minutes", type: "Outpatient & Specialty Care" },
      { facility: "North Florida Pharmacy", distance: "4 minutes", type: "Direct Daily Delivery" },
    ],
    pharmacyPartner: "North Florida Pharmacy (Lake City)",
    powerBackup: "Dedicated Commercial Backup Generator",
    heroDescription:
      "A peaceful retreat along Pinemount Road featuring sun-drenched dayrooms, peaceful walking paths, and a dedicated care team committed to making each day joyful and secure.",
    atmosphere: "Modern, open, sunlit coastal cypress aesthetic with expansive scenic grounds.",
    diningSpecialty: "Pan-seared Florida flounder with lemon herb butter, garden green beans, and warm peach crisp.",
    image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
    bgGradient: "from-emerald-950/50 via-stone-900/60 to-stone-950",
  },
  {
    id: "rising-oaks",
    slug: "rising-oaks-live-oak",
    name: "Rising Oaks Assisted Living",
    tagline: "Historic Charm Under the Live Oaks in Suwannee County",
    legalEntity: "Smith & Sorensen, LLC",
    licenseNumber: "AL13041",
    licenseType: "Standard ALF",
    address: {
      street: "201 NW Ranchera Street",
      city: "Live Oak",
      state: "FL",
      zip: "32064",
      county: "Suwannee County",
    },
    phone: "386-364-2273",
    email: "admin@risingoaksalf.com",
    administrator: {
      name: "Crystal Ducksworth",
      title: "Executive Director",
      phone: "386-364-2273",
      email: "crystal@risingoaksalf.com",
      bio: "Lifelong Suwannee County resident dedicated to honoring our elders with genuine small-town fellowship and deep dignity.",
    },
    licensedBeds: 52,
    occupancyPct: 94,
    availableBeds: 3,
    pricing: {
      semiPrivate: 4000,
      privateSuite: 5550,
    },
    highlights: [
      "Set beneath century-old live oaks draped in Spanish moss in historic Live Oak",
      "Vibrant social calendar including gospel sing-alongs, bingo, and gardening club",
      "Minutes from Shands Live Oak Regional Medical Center",
      "Home-cooked country meals served family-style around shared tables",
    ],
    features: [
      "24/7 Continuous Staff Support & Safety Monitoring",
      "Full eMAR Certified Medication Administration",
      "Screened Rocking Chair Porches Facing Shaded Lawns",
      "Daily Housekeeping, Fresh Linens & Personal Laundry",
      "Spiritual Services & Weekly Local Pastor Fellowship",
      "Suwannee Valley Electric + LP Backup Generator",
    ],
    nearbyHealthcare: [
      { facility: "Shands Live Oak Regional Medical Center", distance: "5 minutes", type: "Full Hospital Services" },
      { facility: "HCA Florida Suwannee Emergency", distance: "6 minutes", type: "24/7 Emergency Care" },
      { facility: "Baya Pharmacy Live Oak", distance: "4 minutes", type: "Daily eMAR Medication Partner" },
    ],
    pharmacyPartner: "Baya Pharmacy (Live Oak)",
    powerBackup: "Suwannee Valley Electric + Automatic LP Generator",
    heroDescription:
      "In the heart of Suwannee County, Rising Oaks captures the authentic charm of old Florida. Here, neighbors care for neighbors under canopy oaks, surrounded by laughter, hymns, and comfort.",
    atmosphere: "Warm, nostalgic Suwannee sanctuary with rocking chairs on wide wooden porches.",
    diningSpecialty: "Southern smothered chicken with buttermilk mashed potatoes, country gravy, and sweet iced tea.",
    image: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1200&q=80",
    bgGradient: "from-amber-950/50 via-stone-900/60 to-stone-950",
  },
  {
    id: "oakridge",
    slug: "oakridge-mayo",
    name: "Oakridge Assisted Living",
    tagline: "The Flagship Country Sanctuary in Lafayette County",
    legalEntity: "Pine House, Inc.",
    licenseNumber: "AL9863",
    licenseType: "Standard ALF",
    address: {
      street: "297 SW County Road 300",
      city: "Mayo",
      state: "FL",
      zip: "32066",
      county: "Lafayette County",
    },
    phone: "386-294-5050",
    email: "admin@oakridgealf.com",
    administrator: {
      name: "Sulma Estrada",
      title: "Executive Director",
      phone: "386-294-5050",
      email: "sulma@oakridgealf.com",
      bio: "Over 12 years of leadership at Oakridge, known by every resident and family member for her boundless empathy and hands-on care.",
    },
    licensedBeds: 52,
    occupancyPct: 94,
    availableBeds: 2,
    pricing: {
      semiPrivate: 4000,
      privateSuite: 5550,
    },
    highlights: [
      "Our historic flagship country estate established with over a decade of flawless care",
      "Serene pastoral setting surrounded by peaceful pastureland and pine forests",
      "Highest resident longevity and staff retention rate in North Florida",
      "Zero state regulatory citations across multiple consecutive state surveys",
    ],
    features: [
      "24/7 Experienced, Long-Tenured Caregiving Team",
      "Nutritional Meals Made From Scratch Every Morning",
      "Spacious Single-Story Corridors with Handrails",
      "Secure Walking Courtyards & Raised Garden Beds",
      "Personalized ADL Assistance Tailored to Every Resident",
      "Duke Energy Commercial Emergency Backup System",
    ],
    nearbyHealthcare: [
      { facility: "Lafayette County Health Department Clinic", distance: "3 minutes", type: "Local Clinical Care" },
      { facility: "Suwannee River Clinic (Mayo)", distance: "4 minutes", type: "Family Medicine & Urgent Care" },
      { facility: "Baya Pharmacy (Mayo & Lake City)", distance: "Daily Delivery", type: "Synchronized eMAR Partner" },
    ],
    pharmacyPartner: "Baya Pharmacy (Mayo/Lake City)",
    powerBackup: "Commercial Heavy-Duty Generator with Duke Energy Grid Sync",
    heroDescription:
      "Oakridge is the soul of Circle of Life. Situated on peaceful County Road 300 in Mayo, this beloved community provides quiet country comfort, loving familiar faces, and unmatched peace of mind.",
    atmosphere: "Peaceful country homestead where deer graze at dawn and evening porch chats are a cherished tradition.",
    diningSpecialty: "Old-fashioned chicken and dumplings with tender sweet corn, buttermilk biscuits, and pecan pie.",
    image: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1200&q=80",
    bgGradient: "from-stone-900/60 via-stone-900/60 to-stone-950",
  },
  {
    id: "homewood",
    slug: "homewood-lodge-mayo",
    name: "Homewood Lodge Assisted Living",
    tagline: "Intimate Boutique Living & High-Attentiveness Care in Mayo",
    legalEntity: "Sorensen, Smith & Bay, LLC",
    licenseNumber: "AL12528",
    licenseType: "Standard ALF",
    address: {
      street: "430 SE Mills Street",
      city: "Mayo",
      state: "FL",
      zip: "32066",
      county: "Lafayette County",
    },
    phone: "386-294-2273",
    email: "admin@homewoodlodge.com",
    administrator: {
      name: "Jackie Ramirez",
      title: "Executive Director",
      phone: "386-294-2273",
      email: "jackie@homewoodlodge.com",
      bio: "Passionate advocate for personalized elder care with an exceptional focus on individualized dignity and comforting daily routines.",
    },
    licensedBeds: 36,
    occupancyPct: 94,
    availableBeds: 2,
    pricing: {
      semiPrivate: 4000,
      privateSuite: 5550,
    },
    highlights: [
      "Boutique, intimate 36-bed lodge setting for residents who prefer quiet, personalized attention",
      "Highest staff-to-resident attentiveness ratio in the region",
      "Quiet residential neighborhood on Mills Street in friendly downtown Mayo",
      "Calming, homelike sensory design that eliminates confusion and wandering anxiety",
    ],
    features: [
      "24/7 Dedicated Caregivers with Low Resident Ratios",
      "Family-Style Kitchen with Fresh Hot Meals Prepared On-Site",
      "Enclosed Private Garden Courtyard with Birdfeeders",
      "Assistance with Dressing, Bathing, Medications, and Transfers",
      "Cozy Fireplace Hearth Room & Library",
      "Duke Energy Commercial Emergency Backup System",
    ],
    nearbyHealthcare: [
      { facility: "Suwannee River Clinic (Mayo)", distance: "2 minutes", type: "Primary Health & Urgent Care" },
      { facility: "Lafayette County Health Center", distance: "3 minutes", type: "Community Health Services" },
      { facility: "Baya Pharmacy", distance: "Daily Delivery", type: "Daily Medication Service" },
    ],
    pharmacyPartner: "Baya Pharmacy",
    powerBackup: "Commercial On-Site LP Generator with Automatic Switch",
    heroDescription:
      "With just 36 beds, Homewood Lodge feels like an extended family home. Located in a tranquil Mayo neighborhood, it is ideal for residents who thrive in a cozy, unhurried, and highly attentive environment.",
    atmosphere: "Intimate boutique country lodge with a warm fireplace parlor and sunny rocking-chair verandas.",
    diningSpecialty: "Farmhouse breakfast skillet with fresh eggs, smoked bacon, homemade biscuits, and local wildflower honey.",
    image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
    bgGradient: "from-stone-900/60 via-amber-950/40 to-stone-950",
  },
];

export const TOTAL_NETWORK_BEDS = 258;
export const TOTAL_COUNTIES = 3;
export const TOTAL_COMMUNITIES = 5;
