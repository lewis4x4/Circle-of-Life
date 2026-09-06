"use client";

import React, { useState } from "react";
import { Utensils, CheckCircle2, Calendar } from "lucide-react";
import Image from "next/image";

interface DiningExperienceProps {
  onOpenTourModal?: () => void;
}

export function DiningExperience({ onOpenTourModal }: DiningExperienceProps) {
  const [selectedDay, setSelectedDay] = useState<"today" | "tomorrow" | "sunday">("today");

  const menus = {
    today: {
      breakfast: "Fluffy buttermilk biscuits, country sausage gravy, fresh scrambled farm eggs & hot coffee",
      lunch: "Slow-roasted chuck pot roast with sweet baby carrots, garden green beans & skillet cornbread",
      dinner: "Creamy homemade chicken noodle soup, garden side salad & warm peach cobbler with vanilla bean cream",
      snack: "Fresh brewed sweet iced tea & warm cinnamon sugar pinwheels",
    },
    tomorrow: {
      breakfast: "Golden blueberry buttermilk pancakes, crispy smoked bacon, fresh orange slices & herbal tea",
      lunch: "Pan-seared Florida flounder with lemon herb butter, seasoned rice pilaf & roasted summer squash",
      dinner: "Savory homestyle meatloaf with garlic mashed potatoes, sweet corn & warm cinnamon apple crisp",
      snack: "Local tupelo honey yogurt parfait with toasted granola",
    },
    sunday: {
      breakfast: "Southern breakfast skillet with peppers, onions, country ham & warm scratch biscuits",
      lunch: "Crispy Southern smothered chicken with buttermilk mashed potatoes, country gravy & green beans",
      dinner: "Light honey-glazed turkey sliders, garden pasta salad & fresh blackberry pie",
      snack: "Warm Southern pecan squares & fresh brewed iced sweet tea",
    },
  };

  const currentMenu = menus[selectedDay];

  return (
    <section className="py-24 bg-white border-b border-stone-200/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Narrative (6 cols) */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#C85A32]/10 text-[#A94724] text-xs font-bold uppercase tracking-widest">
              <Utensils className="w-3.5 h-3.5" />
              <span>The Suwannee Valley Dining Table</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C2822] font-serif leading-tight">
              Food is Fellowship. Every Meal is Made from Scratch.
            </h2>

            <p className="text-stone-700 text-sm sm:text-base leading-relaxed">
              At Circle of Life, nobody eats alone off a plastic cafeteria tray in a dark bedroom.
              Our dining rooms are warm, sunlit gathering places where stories are swapped, prayers are
              shared before meals, and Southern comfort food is prepared fresh three times a day by our on-site culinary team.
            </p>

            <div className="space-y-3.5 text-xs sm:text-sm text-stone-800 font-medium">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-[#A94724] shrink-0 mt-0.5" />
                <span>Three hot chef-prepared meals daily plus two refreshing hydration and snack rounds</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-[#A94724] shrink-0 mt-0.5" />
                <span>Dietitian-approved HACCP nutrition with texture modifications (Soft, Pureed, Diabetic)</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-[#A94724] shrink-0 mt-0.5" />
                <span>Family members are always welcome to pull up a chair and join for Sunday dinner on the house</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={onOpenTourModal}
                className="inline-flex items-center gap-2.5 px-7 py-4 rounded-2xl bg-[#1C2822] text-white font-bold text-xs hover:bg-stone-800 transition-colors shadow-lg shadow-stone-900/20"
              >
                <Calendar className="w-4 h-4 text-[#E5A952]" />
                <span>Join Us for Sunday Dinner on Your Tour</span>
              </button>
            </div>
          </div>

          {/* Right Column: Live Menu Card & Food Image (6 cols) */}
          <div className="lg:col-span-6 space-y-6">
            {/* Visual Photography Accent */}
            <div className="relative rounded-3xl overflow-hidden shadow-xl h-56 w-full bg-stone-900">
              <Image
                src="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80"
                alt="Southern Farm to Table Dining"
                className="w-full h-full object-cover" unoptimized loading="eager" fill sizes="100vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-5 right-5 text-white flex items-center justify-between">
                <div className="font-serif font-bold text-lg">Fresh Country Cooking Daily</div>
                <span className="text-[11px] text-amber-300 font-semibold bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full">
                  Locally Sourced Ingredients
                </span>
              </div>
            </div>

            {/* Live Menu Card Widget */}
            <div className="bg-[#FAF7F2] rounded-3xl p-6 sm:p-8 border-2 border-stone-200 shadow-lg space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-200">
                <div>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#3D5A4C]">
                    Dietary Deck Sync
                  </span>
                  <h3 className="text-xl font-bold text-[#1C2822] font-serif">Today&apos;s Chef Menu</h3>
                </div>

                <div className="flex gap-1 bg-white p-1 rounded-xl border border-stone-200 text-xs font-bold shadow-2xs">
                  <button
                    onClick={() => setSelectedDay("today")}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      selectedDay === "today" ? "bg-[#1C2822] text-white" : "text-stone-600"
                    }`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setSelectedDay("tomorrow")}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      selectedDay === "tomorrow" ? "bg-[#1C2822] text-white" : "text-stone-600"
                    }`}
                  >
                    Tomorrow
                  </button>
                  <button
                    onClick={() => setSelectedDay("sunday")}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      selectedDay === "sunday" ? "bg-[#1C2822] text-white" : "text-stone-600"
                    }`}
                  >
                    Sunday Roast
                  </button>
                </div>
              </div>

              {/* Menu Items */}
              <div className="grid gap-3 pt-1">
                <div className="p-3.5 rounded-2xl bg-white border border-stone-200 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#A94724] mb-0.5">
                    🌅 Country Breakfast
                  </div>
                  <div className="text-xs sm:text-sm font-semibold text-[#1C2822]">
                    {currentMenu.breakfast}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-stone-200 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#3D5A4C] mb-0.5">
                    🍲 Midday Family Lunch (Main Meal)
                  </div>
                  <div className="text-xs sm:text-sm font-semibold text-[#1C2822]">
                    {currentMenu.lunch}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-stone-200 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-0.5">
                    🌆 Comforting Evening Supper
                  </div>
                  <div className="text-xs sm:text-sm font-semibold text-[#1C2822]">
                    {currentMenu.dinner}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
