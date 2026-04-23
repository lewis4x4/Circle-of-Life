"use client";

import dynamic from "next/dynamic";

// The Grace corner (chat assistant) and Haven Insight panel each pull in
// framer-motion and a pile of context/provider code. Neither is needed for
// first paint — they both live in bottom-right corner buttons. Dynamic-import
// them with ssr:false so the admin layout's initial client bundle stays
// small, and these shells load after the page is interactive.
const GraceShell = dynamic(
  () => import("@/lib/grace/GraceShell").then((m) => ({ default: m.GraceShell })),
  { ssr: false, loading: () => null },
);

const HavenInsightShell = dynamic(
  () =>
    import("@/components/haven-insight/HavenInsightShell").then((m) => ({
      default: m.HavenInsightShell,
    })),
  { ssr: false, loading: () => null },
);

export function LazyOverlayShells() {
  return (
    <>
      <GraceShell />
      <HavenInsightShell />
    </>
  );
}
