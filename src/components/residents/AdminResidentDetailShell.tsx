"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { Brain, FileText, Stethoscope } from "lucide-react";

import {
  BehaviorLogModal,
  ConditionLogModal,
  GeneralNoteModal,
} from "@/components/admin/resident-log-modals";
import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { ResidentDetailTabStrip } from "@/components/residents/ResidentDetailTabStrip";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { RecordDetailHeader } from "@/design-system/components/record-detail";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  adminResidentDetailHrefs,
  residentDetailTabFromSegment,
} from "@/lib/residents/resident-detail-navigation";
import {
  loadResidentOverviewDetail,
  type ResidentOverviewDetail,
} from "@/lib/residents/resident-detail-overview-load";
import { acuityDisplay } from "@/lib/residents/resident-acuity-display";
import { RESIDENT_NO_UNIT_COPY as NO_UNIT_COPY } from "@/lib/residents/roster-display-copy";
import { formatResidentOverviewGenderLabel } from "@/lib/residents/resident-overview-display-copy";
import {
  isPresenceStatus,
  lifecycleStatusLabel,
  presenceLabel,
  presenceTone,
} from "@/lib/residents/presence";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type AdminResidentDetailShellProps = {
  children: ReactNode;
  initialDetail: ResidentOverviewDetail | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

export function AdminResidentDetailShell({
  children,
  initialDetail,
  initialError,
  initialFacilityId,
}: AdminResidentDetailShellProps) {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const selectedSegment = useSelectedLayoutSegment();
  const activeTab = residentDetailTabFromSegment(selectedSegment);
  const hrefs = useMemo(() => adminResidentDetailHrefs(residentId), [residentId]);
  const { selectedFacilityId } = useFacilityStore();
  const skipNextLoadRef = useRef(initialError == null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notFound, setNotFound] = useState(!initialDetail && !initialError);
  const [detail, setDetail] = useState<ResidentOverviewDetail | null>(initialDetail);
  const [behaviorModalOpen, setBehaviorModalOpen] = useState(false);
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const [generalNoteModalOpen, setGeneralNoteModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setLoading(true);
    setError(null);
    setNotFound(false);

    if (!residentId || !UUID_STRING_RE.test(residentId)) {
      setDetail(null);
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const row = await loadResidentOverviewDetail(residentId, selectedFacilityId);
      setDetail(row);
      setNotFound(!row);
    } catch (loadError) {
      setDetail(null);
      setError(
        formatLiveDataLoadError(
          loadError,
          "Live resident profile is unavailable right now.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [initialFacilityId, residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The overview already owns this exact header. Child routes inherit it here,
  // so the resident identity and tabs remain mounted while their content swaps.
  if (selectedSegment == null) return children;

  if (!detail) {
    return (
      <div className="fade-in animate-in flex max-w-[1440px] flex-col gap-4 pb-4 pt-2 duration-[var(--motion-duration)]">
        <Link
          prefetch={false}
          href={hrefs.rosterHref}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "inline-flex gap-1",
          )}
        >
          ← Resident roster
        </Link>
        {loading ? <AdminTableLoadingState /> : null}
        {notFound ? (
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-xl">Resident profile header unavailable</CardTitle>
              <CardDescription>
                This profile may be outside your facility filter, discharged, or the link is invalid.
                The selected tab remains available below.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
        {error ? (
          <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
        ) : null}

        <div className="w-full shrink-0">
          <ResidentDetailTabStrip hrefs={hrefs} active={activeTab} />
        </div>

        <div className="min-w-0">{children}</div>
      </div>
    );
  }

  const acuity = acuityDisplay(detail.acuityLevel);
  const subtitle = [
    detail.ageYears != null ? `Age ${detail.ageYears}` : "Age not recorded",
    formatResidentOverviewGenderLabel(detail.gender),
    `Room ${detail.roomLabel}`,
    detail.unitName || NO_UNIT_COPY,
    `Admitted ${detail.admissionLabel}`,
  ].join(" · ");

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-4 pt-2">
      <RecordDetailHeader
        title={detail.fullName}
        subtitle={subtitle}
        backLink={{ label: "Resident roster", href: hrefs.rosterHref }}
        statusChips={
          <>
            {!isPresenceStatus(detail.rawStatus) ? (
              <StatusPill tone="muted">{lifecycleStatusLabel(detail.rawStatus)}</StatusPill>
            ) : (
              <StatusPill tone={presenceTone(detail.status)}>{presenceLabel(detail.status)}</StatusPill>
            )}
            {acuity.tone === "gap" ? (
              <span className="text-[13px] text-muted-foreground">{acuity.label}</span>
            ) : (
              <StatusPill tone={acuity.tone} className="normal-case tracking-tight">
                {acuity.label}
              </StatusPill>
            )}
          </>
        }
        actions={
          <div className="flex shrink-0 flex-col items-end gap-2 md:flex-row md:items-start">
            <div className="grid w-[calc(100vw-2rem)] grid-cols-3 items-center gap-2 md:flex md:w-auto md:flex-row md:flex-wrap">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBehaviorModalOpen(true)}
                className="h-auto min-h-[44px] min-w-0 px-2 py-2 text-[12px] font-medium sm:px-4 sm:text-[13px] md:h-10 md:min-h-0 md:py-0"
              >
                <Brain className="mr-1.5 size-4" aria-hidden /> Log behavior
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConditionModalOpen(true)}
                className="h-auto min-h-[44px] min-w-0 px-2 py-2 text-[12px] font-medium sm:px-4 sm:text-[13px] md:h-10 md:min-h-0 md:py-0"
              >
                <Stethoscope className="mr-1.5 size-4" aria-hidden /> Log condition
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setGeneralNoteModalOpen(true)}
                className="h-auto min-h-[44px] min-w-0 px-2 py-2 text-[12px] font-medium sm:px-4 sm:text-[13px] md:h-10 md:min-h-0 md:py-0"
              >
                <FileText className="mr-1.5 size-4" aria-hidden /> General note
              </Button>
            </div>
          </div>
        }
      />

      <div className="w-full shrink-0">
        <ResidentDetailTabStrip hrefs={hrefs} active={activeTab} />
      </div>

      <div className="min-w-0">{children}</div>

      <BehaviorLogModal
        open={behaviorModalOpen}
        onOpenChange={setBehaviorModalOpen}
        residentId={residentId}
        residentName={detail.fullName}
        onSuccess={() => void load()}
      />
      <ConditionLogModal
        open={conditionModalOpen}
        onOpenChange={setConditionModalOpen}
        residentId={residentId}
        residentName={detail.fullName}
        onSuccess={() => void load()}
      />
      <GeneralNoteModal
        open={generalNoteModalOpen}
        onOpenChange={setGeneralNoteModalOpen}
        residentId={residentId}
        residentName={detail.fullName}
        onSuccess={() => void load()}
      />
    </div>
  );
}
