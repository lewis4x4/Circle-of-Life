"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { applyColDiscoveryForFacility } from "@/lib/rounding/apply-col-discovery-for-facility";
import { describeColDiscoveryCadenceForFacility } from "@/lib/rounding/col-discovery-round-cadence";
import { cn } from "@/lib/utils";

type DiscoveryCadenceApplyPanelProps = {
  facilityId: string;
  facilityName: string;
  className?: string;
};

export function DiscoveryCadenceApplyPanel({
  facilityId,
  facilityName,
  className,
}: DiscoveryCadenceApplyPanelProps) {
  const router = useRouter();
  const cadence = describeColDiscoveryCadenceForFacility(facilityName);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"muted" | "warning">("muted");

  async function handleApply() {
    if (!cadence.canApply || applying) return;

    setApplying(true);
    setNotice(null);

    const result = await applyColDiscoveryForFacility({ facilityId, facilityName });
    if (result.ok) {
      router.push("/admin/rounding/live");
      return;
    }

    setNoticeTone(result.code === "empty_census" ? "muted" : "warning");
    setNotice(result.message);
    setApplying(false);
  }

  return (
    <section
      aria-label="Jessica discovery round cadence"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <ClipboardList className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">{cadence.headline}</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{cadence.detail}</p>
          {notice ? (
            <p
              className={cn(
                "text-[13px] leading-relaxed",
                noticeTone === "warning" ? "text-warning" : "text-muted-foreground",
              )}
              role="status"
            >
              {notice}
            </p>
          ) : null}
        </div>
      </div>

      {cadence.canApply ? (
        <Button
          type="button"
          className="shrink-0"
          disabled={applying}
          onClick={() => void handleApply()}
        >
          {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          Apply discovery rounds
        </Button>
      ) : (
        <p className="shrink-0 text-[12px] text-muted-foreground md:max-w-[12rem] md:text-right">
          {cadence.profile === "pending"
            ? "Apply stays blocked until owner supplies Plantation times."
            : "Not available for this facility."}
        </p>
      )}
    </section>
  );
}
