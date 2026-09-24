"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { CareEventKind } from "@/lib/care-events/level-engine";

import { FloorReportScreen } from "./FloorReportScreen";

/** Start over is a fresh flow: a new client event id and an empty state, prefill dropped. */
export function FloorReportRoute({ prefillResidentId, prefillKind }: { prefillResidentId: string | null; prefillKind: CareEventKind | null }) {
  const router = useRouter();
  const [run, setRun] = useState(0);
  return (
    <FloorReportScreen
      key={run}
      prefillResidentId={run === 0 ? prefillResidentId : null}
      prefillKind={run === 0 ? prefillKind : null}
      onStartOver={() => {
        if (prefillResidentId || prefillKind) router.replace("/floor/report");
        setRun((value) => value + 1);
      }}
    />
  );
}
