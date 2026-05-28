"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// The Grace corner (chat assistant) and Haven Insight panel each pull in
// overlay/provider code that is unnecessary for first paint. Keep only this
// lightweight event bridge in the initial AppShell bundle and load the heavy
// shells after the page is interactive.
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
  const [graceOpenRequestToken, setGraceOpenRequestToken] = useState(0);
  const [graceToggleRequestToken, setGraceToggleRequestToken] = useState(0);
  const [havenInsightOpenRequestToken, setHavenInsightOpenRequestToken] = useState(0);
  const [havenInsightToggleRequestToken, setHavenInsightToggleRequestToken] = useState(0);

  useEffect(() => {
    const onGraceOpen = () => setGraceOpenRequestToken((token) => token + 1);
    const onHavenInsightOpen = () => setHavenInsightOpenRequestToken((token) => token + 1);

    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
      if (!cmdOrCtrl) return;

      const key = event.key.toLowerCase();
      if (key === "g") {
        event.preventDefault();
        setGraceToggleRequestToken((token) => token + 1);
        return;
      }

      if (event.shiftKey && key === "i") {
        event.preventDefault();
        setHavenInsightToggleRequestToken((token) => token + 1);
      }
    };

    window.addEventListener("grace:open", onGraceOpen);
    window.addEventListener("haven-insight:open", onHavenInsightOpen);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("grace:open", onGraceOpen);
      window.removeEventListener("haven-insight:open", onHavenInsightOpen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const shouldRenderGraceShell = graceOpenRequestToken > 0 || graceToggleRequestToken > 0;
  const shouldRenderHavenInsightShell =
    havenInsightOpenRequestToken > 0 || havenInsightToggleRequestToken > 0;

  return (
    <>
      {shouldRenderGraceShell ? (
        <GraceShell
          openRequestToken={graceOpenRequestToken}
          toggleRequestToken={graceToggleRequestToken}
        />
      ) : null}
      {shouldRenderHavenInsightShell ? (
        <HavenInsightShell
          openRequestToken={havenInsightOpenRequestToken}
          toggleRequestToken={havenInsightToggleRequestToken}
        />
      ) : null}
    </>
  );
}
