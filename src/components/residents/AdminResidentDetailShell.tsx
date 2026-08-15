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
import {
  isPresenceStatus,
  lifecycleStatusLabel,
  presenceLabel,
  presenceTone,
} from "@/lib/residents/presence";
import { formatResidentOverviewGenderLabel } from "@/lib/residents/resident-overview-display-copy";
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

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-4 pt-2">
      {detail && !notFound && !error ? (
        <RecordDetailHeader
          title={detail.fullName}
          subtitle={`${detail.ageYears != null ? `Age ${detail.ageYears}` : "Age pending"} · ${formatResidentOverviewGenderLabel(detail.gender)} · Room ${detail.roomLabel} · Admitted ${detail.admissionLabel}`}
          backLink={{ label: "Resident roster", href: hrefs.rosterHref }}
          statusChips={
            !isPresenceStatus(detail.rawStatus) ? (
              <StatusPill tone="muted">{lifecycleStatusLabel(detail.rawStatus)}</StatusPill>
            ) : detail.status !== "active" ? (
              <StatusPill tone={presenceTone(detail.status)}>
                {presenceLabel(detail.status)}
              </StatusPill>
            ) : null
          }
          actions={
            <div className="flex shrink-0 flex-col items-end gap-2 md:flex-row md:items-start">
              <div className="flex flex-row flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setBehaviorModalOpen(true)}
                  className="hover:bg-secondary/70 h-auto min-w-[134px] max-w-[150px] border border-transparent px-3 py-2 text-[12px] font-medium hover:border-border"
                >
                  <Brain className="mr-1.5 size-4" aria-hidden /> Log behavior
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConditionModalOpen(true)}
                  className="hover:bg-secondary/70 h-auto min-w-[134px] max-w-[150px] border border-transparent px-3 py-2 text-[12px] font-medium hover:border-border"
                >
                  <Stethoscope className="mr-1.5 size-4" aria-hidden /> Log condition
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setGeneralNoteModalOpen(true)}
                  className="hover:bg-secondary/70 h-auto min-w-[134px] max-w-[150px] border border-transparent px-3 py-2 text-[12px] font-medium hover:border-border"
                >
                  <FileText className="mr-1.5 size-4" aria-hidden /> General note
                </Button>
              </div>
            </div>
          }
        />
      ) : (
        <div className="fade-in animate-in space-y-6 duration-[var(--motion-duration)]">
          <Link
            prefetch={false}
            href={hrefs.rosterHref}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            ← Resident roster
          </Link>
          {loading && !detail ? <AdminTableLoadingState /> : null}
          {notFound ? (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-xl">Resident not found</CardTitle>
                <CardDescription>
                  This profile may be outside your facility filter, discharged, or the link is
                  invalid.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {error ? (
            <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
          ) : null}
        </div>
      )}

      <div className="w-full shrink-0">
        <ResidentDetailTabStrip hrefs={hrefs} active={activeTab} />
      </div>

      <div className="min-w-0">{children}</div>

      {detail ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
