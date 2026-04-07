"use client";

import dynamic from "next/dynamic";

const LandingHome = dynamic(() => import("@/components/landing/landing-home"), {
  loading: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
    </div>
  ),
  ssr: false,
});

export default function Home() {
  return <LandingHome />;
}
