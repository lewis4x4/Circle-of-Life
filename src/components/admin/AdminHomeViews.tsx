"use client";

import dynamic from "next/dynamic";

// Dynamic client imports must live in a client boundary to split their code.
// The server still selects the authorized view and prerenders its initial data.
export const AdminDashboardPageClient = dynamic(() =>
  import("./AdminDashboardPageClient").then((module) => module.AdminDashboardPageClient),
);

export const FacilityOperatorHomePageClient = dynamic(() =>
  import("@/components/home/FacilityOperatorHomePageClient").then((module) => module.FacilityOperatorHomePageClient),
);
