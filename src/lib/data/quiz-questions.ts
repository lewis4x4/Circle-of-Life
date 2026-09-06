export interface QuizOption {
  text: string;
  points: number;
  category: "independence" | "mild" | "moderate" | "urgent";
}

export interface QuizQuestion {
  id: number;
  title: string;
  subtitle: string;
  options: QuizOption[];
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 1,
    title: "How is your loved one managing their daily medications?",
    subtitle: "Missed doses or incorrect pill timing is the #1 cause of preventable hospital readmissions.",
    options: [
      {
        text: "They manage independently without any reminders or mistakes.",
        points: 0,
        category: "independence",
      },
      {
        text: "They occasionally forget a dose or need verbal reminders and pillbox refills.",
        points: 2,
        category: "mild",
      },
      {
        text: "They frequently miss medications, take double doses, or struggle to open bottles.",
        points: 5,
        category: "moderate",
      },
      {
        text: "They have had a dangerous medication mix-up, overdose, or ER visit recently.",
        points: 8,
        category: "urgent",
      },
    ],
  },
  {
    id: 2,
    title: "How are meals, nutrition, and hydration at home?",
    subtitle: "A balanced diet and adequate hydration maintain physical vitality and prevent cognitive fog.",
    options: [
      {
        text: "They cook balanced meals daily and maintain a healthy appetite and weight.",
        points: 0,
        category: "independence",
      },
      {
        text: "They rely heavily on frozen TV dinners, canned soups, or skip occasional meals.",
        points: 2,
        category: "mild",
      },
      {
        text: "The refrigerator is often empty or filled with expired food; noticeable weight loss.",
        points: 5,
        category: "moderate",
      },
      {
        text: "They leave the stove or oven on unattended; severe weight loss or dehydration risk.",
        points: 8,
        category: "urgent",
      },
    ],
  },
  {
    id: 3,
    title: "What is their mobility and fall history over the past 6 months?",
    subtitle: "Falls in the bathroom or bedroom during the night carry significant risk.",
    options: [
      {
        text: "Walks securely without assistance or fear of falling.",
        points: 0,
        category: "independence",
      },
      {
        text: "Uses a cane or walker; moves slowly and feels slightly unsteady on stairs.",
        points: 2,
        category: "mild",
      },
      {
        text: "Has had 1 or 2 minor falls or near-misses; struggles to get up from chairs or toilet.",
        points: 5,
        category: "moderate",
      },
      {
        text: "Has fallen repeatedly, had an emergency room transport, or spent hours on the floor.",
        points: 8,
        category: "urgent",
      },
    ],
  },
  {
    id: 4,
    title: "How are personal bathing, dressing, and hygiene routines?",
    subtitle: "Bathing is often where physical weakness and bathroom safety converge.",
    options: [
      {
        text: "Showers, dresses, and grooms independently without any difficulty.",
        points: 0,
        category: "independence",
      },
      {
        text: "Needs light assistance with fastening buttons, putting on socks, or washing back.",
        points: 2,
        category: "mild",
      },
      {
        text: "Is fearful of getting in/out of the shower; wears the same clothes for days.",
        points: 5,
        category: "moderate",
      },
      {
        text: "Unable to bathe or dress without full physical support; skin breakdown concerns.",
        points: 8,
        category: "urgent",
      },
    ],
  },
  {
    id: 5,
    title: "How are you (the family caregiver) feeling physically and emotionally?",
    subtitle: "Caregiver exhaustion is real. Protecting your health is essential for your family.",
    options: [
      {
        text: "I feel balanced and have plenty of energy for my own work and family life.",
        points: 0,
        category: "independence",
      },
      {
        text: "I am feeling stressed and finding it hard to juggle work, kids, and caregiving.",
        points: 2,
        category: "mild",
      },
      {
        text: "I am exhausted, losing sleep, anxious every time the phone rings, and burning out.",
        points: 5,
        category: "moderate",
      },
      {
        text: "I am at a complete breaking point; my own physical or mental health is in crisis.",
        points: 8,
        category: "urgent",
      },
    ],
  },
];
