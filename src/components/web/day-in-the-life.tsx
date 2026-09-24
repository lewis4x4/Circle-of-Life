"use client";

import React, { useState } from "react";
import { Sun, Moon, Coffee, Utensils, Music, Clock, Sparkles } from "lucide-react";
import Image from "next/image";

interface TimelineEvent {
  time: string;
  period: "morning" | "midday" | "afternoon" | "evening" | "night";
  title: string;
  subtitle: string;
  description: string;
  quote: string;
  careDetails: string[];
  image: string;
  icon: typeof Sun;
}

export function DayInTheLife() {
  const [activeStep, setActiveStep] = useState<number>(0);

  const timeline: TimelineEvent[] = [
    {
      time: "07:30 AM",
      period: "morning",
      title: "The Gentle Morning Knock",
      subtitle: "Warm smiles, hot coffee brewed fresh, and certified medication safety",
      description:
        "Your mom is never rushed. A familiar caregiver knocks softly, brings her favorite cup of hot coffee with a splash of cream, and assists with her morning medications. She gets dressed at her own unhurried pace.",
      quote:
        "“Good morning Miss Martha! The morning sunshine through the oaks is just beautiful today. Ready for warm buttermilk biscuits?”",
      careDetails: [
        "Certified eMAR medication pass with 6-rights verification",
        "Gentle assistance with morning dressing and personal grooming",
        "Hydration and morning vital sign check",
      ],
      image: "https://images.unsplash.com/photo-1544027993-37dbfe43562a?auto=format&fit=crop&w=1000&q=80",
      icon: Coffee,
    },
    {
      time: "09:00 AM",
      period: "morning",
      title: "Front Porch Fellowship Under the Oaks",
      subtitle: "Rocking chairs, morning birdsong, and genuine neighborly warmth",
      description:
        "Residents gather on the screened verandas to feel the cool morning breeze. Rocking chairs click softly on the wood as neighbors share childhood stories, watch hummingbirds at the feeders, and read the local paper.",
      quote:
        "“Sitting out here with friends listening to the mourning doves reminds me of my grandmother's porch in Suwannee County.”",
      careDetails: [
        "Safe outdoor step-free walking access to shaded pavilions",
        "Staff companionship and gentle social engagement",
        "Mid-morning fresh fruit and juice refreshment round",
      ],
      image: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1000&q=80",
      icon: Sun,
    },
    {
      time: "12:00 PM",
      period: "midday",
      title: "The Suwannee Valley Family Dining Table",
      subtitle: "Home-cooked Southern roast, fresh garden green beans & hot skillet cornbread",
      description:
        "Lunch is the centerpiece of fellowship. Tables are dressed with cloth linens and fresh flowers. Nobody eats off an institutional plastic tray in a dark bedroom—everyone gathers as one extended family.",
      quote:
        "“That pot roast melts in your mouth, and the blackberry cobbler tastes just like Sunday dinner after church.”",
      careDetails: [
        "Dietitian-approved HACCP nutrition with texture modifications if needed",
        "Caregivers assist with tray escort, seating, and meal setup",
        "Social interaction that prevents isolation and stimulates appetite",
      ],
      image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80",
      icon: Utensils,
    },
    {
      time: "02:30 PM",
      period: "afternoon",
      title: "Afternoon Purpose, Gardening & Hymns",
      subtitle: "Stimulating the mind, uplifting the soul, and celebrating lifelong passions",
      description:
        "Whether it's tending to raised heirloom tomato beds, playing dominoes, baking fresh peach pies in the activity kitchen, or singing beloved gospel hymns in the parlor, every afternoon is filled with dignity and laughter.",
      quote:
        "“When we sang 'How Great Thou Art' around the piano today, I saw my mama smile for the first time in months.”",
      careDetails: [
        "Cognitive enrichment, memory games, and tactile art therapy",
        "Faith-based fellowship and weekly local pastor visits",
        "Afternoon medication pass and hydration check",
      ],
      image: "https://images.unsplash.com/photo-1516726817505-f5ed825624d8?auto=format&fit=crop&w=1000&q=80",
      icon: Music,
    },
    {
      time: "06:00 PM",
      period: "evening",
      title: "Golden Hour Stroll & Evening Supper",
      subtitle: "Sunset through the pines followed by a comforting light supper",
      description:
        "As the Florida sun casts golden rays through the Spanish moss, residents take leisurely guided walks along flat, paved courtyard paths before enjoying a comforting supper of homemade soup, salad, and warm tea.",
      quote:
        "“The quiet of the country in the evening brings such a deep peace to the soul.”",
      careDetails: [
        "Light, easily digestible evening dining tailored for sound sleep",
        "Fall prevention standby during evening golden hour strolls",
        "Family members encouraged to join for supper anytime",
      ],
      image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80",
      icon: Sun,
    },
    {
      time: "08:30 PM",
      period: "night",
      title: "Peaceful Rest & 24/7 Dedicated Vigilance",
      subtitle: "Tucked into clean sheets with night-lights on. You can finally sleep without worry.",
      description:
        "Staff assist with evening hygiene, nightgowns, and bedtime routines. Night caregivers remain awake and attentive on every hall, performing quiet safety rounds so you can finally rest through the night.",
      quote:
        "“For the first time in three years, I went to sleep knowing my father was safe, dry, loved, and protected.”",
      careDetails: [
        "Quiet hourly nighttime safety rounds and call-pendant monitoring",
        "Certified overnight medication and urgent care response",
        "Emergency commercial generators ensuring continuous power and comfort",
      ],
      image: "https://images.unsplash.com/photo-1540518614846-7ede433c4ef7?auto=format&fit=crop&w=1000&q=80",
      icon: Moon,
    },
  ];

  const current = timeline[activeStep];
  const IconComponent = current.icon;

  return (
    <section className="py-24 bg-[#FAF7F2] overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#C85A32]/10 text-[#A94724] text-xs font-bold uppercase tracking-widest mb-2">
            <Clock className="w-3.5 h-3.5" />
            <span>Interactive Daily Rhythm</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C2822] font-serif">
            A Day in the Life of Your Loved One
          </h2>
          <p className="text-stone-600 text-sm sm:text-base mt-2">
            Drag the time slider below to experience the gentle, purposeful rhythm of life at Circle of Life.
          </p>
        </div>

        {/* Time Steps Selector */}
        <div className="flex items-center justify-between gap-2.5 max-w-4xl mx-auto mb-10 overflow-x-auto pb-4 pt-2 px-2">
          {timeline.map((item, idx) => (
            <button
              key={idx}
              onClick={() => setActiveStep(idx)}
              className={`flex-1 min-w-[120px] p-3.5 rounded-2xl text-center border-2 transition-all ${
                activeStep === idx
                  ? "bg-[#1C2822] border-[#1C2822] text-white shadow-xl scale-105"
                  : "bg-white border-stone-200 text-stone-700 hover:border-stone-400 shadow-2xs"
              }`}
            >
              <div className="text-xs font-bold font-mono tracking-wide">{item.time}</div>
              <div
                className={`text-[11px] truncate mt-0.5 font-medium ${
                  activeStep === idx ? "text-[#E5A952]" : "text-stone-600"
                }`}
              >
                {item.title.split(" ").slice(0, 2).join(" ")}
              </div>
            </button>
          ))}
        </div>

        {/* Active Stage Display Showcase */}
        <div className="max-w-5xl mx-auto bg-white rounded-3xl p-6 sm:p-10 border-2 border-stone-200 shadow-2xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left: Image Container (5 cols) */}
          <div className="lg:col-span-5 relative rounded-3xl overflow-hidden h-72 sm:h-96 shadow-lg bg-stone-900">
            <Image
              src={current.image}
              alt={current.title}
              className="w-full h-full object-cover" unoptimized loading="eager" fill sizes="100vw"
            />
            <div className="absolute top-4 left-4 px-3.5 py-1.5 rounded-full bg-[#1C2822]/90 backdrop-blur-md text-[#E5A952] text-xs font-bold flex items-center gap-1.5 border border-stone-700 shadow-sm">
              <IconComponent className="w-4 h-4 text-[#E5A952]" />
              <span>{current.time}</span>
            </div>
          </div>

          {/* Right: Narrative Details (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                {current.subtitle}
              </span>
              <h3 className="text-2xl sm:text-3xl font-bold text-[#1C2822] font-serif mt-1">
                {current.title}
              </h3>
            </div>

            <p className="text-sm text-stone-700 leading-relaxed">{current.description}</p>

            {/* Emotional Quote Bubble */}
            <div className="p-4 rounded-2xl bg-[#FAF7F2] border-l-4 border-[#C85A32] text-xs sm:text-sm italic text-[#1C2822] font-serif">
              {current.quote}
            </div>

            {/* Care Protocol Badges */}
            <div className="space-y-2 pt-2">
              <span className="text-[11px] uppercase tracking-widest font-bold text-stone-600 block">
                Care Protocols in Motion:
              </span>
              <div className="grid gap-1.5">
                {current.careDetails.map((detail, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-[#3D5A4C] font-semibold">
                    <Sparkles className="w-3.5 h-3.5 text-[#A94724] shrink-0" />
                    <span>{detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
