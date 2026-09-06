"use client";

import React, { useState } from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { HeroSection } from "@/components/web/hero-section";
import { TrustBadgesSection } from "@/components/web/trust-badges-section";
import { CampusGrid } from "@/components/web/campus-grid";
import { CostCalculator } from "@/components/web/cost-calculator";
import { DayInTheLife } from "@/components/web/day-in-the-life";
import { RoomVisualizer } from "@/components/web/room-visualizer";
import { AssessmentQuizWidget } from "@/components/web/assessment-quiz-widget";
import { DiningExperience } from "@/components/web/dining-experience";
import { BuilderStory } from "@/components/web/builder-story";
import { RegionalMap } from "@/components/web/regional-map";
import { VideoTestimonials } from "@/components/web/video-testimonials";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { TourSchedulerModal } from "@/components/web/tour-scheduler-modal";

export default function HomePage() {
  const [tourModalOpen, setTourModalOpen] = useState(false);
  const [selectedTourFacility, setSelectedTourFacility] = useState<string | undefined>();

  const handleOpenTour = (facilityId?: string) => {
    setSelectedTourFacility(facilityId);
    setTourModalOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#faf7f2] text-[#1e2b24] font-sans selection:bg-[#c86d51]/20 selection:text-[#1e2b24]">
      {/* Master Web Header */}
      <WebHeader onOpenTourModal={() => handleOpenTour()} />

      {/* Main Content Sections */}
      <main className="flex-1">
        {/* 1. Hero Section with Emotional Copy & Quick Campus Finder */}
        <HeroSection onOpenTourModal={() => handleOpenTour()} />

        {/* 2. State & Safety Trust Badges (100% AHCA Clean Record, FBI Screened) */}
        <TrustBadgesSection />

        {/* 3. 5 North Florida Campuses (Including Plantation on Summers) */}
        <CampusGrid onOpenTourModal={handleOpenTour} />

        {/* 4. Interactive Care & Monthly Investment Calculator (VA Aid / Medicaid) */}
        <CostCalculator onOpenTourModal={() => handleOpenTour()} />

        {/* 5. A Day in the Life (Sun-Slider from 07:30 AM to 08:30 PM) */}
        <DayInTheLife />

        {/* 6. Interactive 3D Suite & Room Studio */}
        <RoomVisualizer onOpenTourModal={() => handleOpenTour()} />

        {/* 7. "Is Assisted Living Right for Mom?" 60-Second Quiz */}
        <AssessmentQuizWidget onOpenTourModal={() => handleOpenTour()} />

        {/* 8. The Suwannee Valley Dining Table & Live Chef's Menu */}
        <DiningExperience onOpenTourModal={() => handleOpenTour()} />

        {/* 9. The Builder's Story & 50-Year Craftsmanship Legacy */}
        <BuilderStory />

        {/* 10. Regional Cartography & Hospital Travel Times */}
        <RegionalMap />

        {/* 11. Real Family Video & Audio Testimonials */}
        <VideoTestimonials />
      </main>

      {/* Master Footer */}
      <WebFooter />

      {/* Persistent Mobile Care Concierge */}
      <StickyCareConcierge onOpenTourModal={() => handleOpenTour()} />

      {/* Self-Scheduling VIP Tour Modal */}
      <TourSchedulerModal
        isOpen={tourModalOpen}
        onClose={() => setTourModalOpen(false)}
        defaultFacilityId={selectedTourFacility}
      />
    </div>
  );
}
