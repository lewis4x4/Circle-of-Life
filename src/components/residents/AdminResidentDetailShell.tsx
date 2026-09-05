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
  const requestVersionRef = useRef(0);
  const [loadedScope, setLoadedScope] = useState({
    residentId,
    facilityId: initialFacilityId,
  });
  const scopeMatches =
    loadedScope.residentId === residentId &&
    loadedScope.facilityId === selectedFacilityId;

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

    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    setError(null);

    if (!residentId || !UUID_STRING_RE.test(residentId)) {
      setLoadedScope({ residentId, facilityId: selectedFacilityId });
      setDetail(null);
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const row = await loadResidentOverviewDetail(residentId, selectedFacilityId);
      if (requestVersion !== requestVersionRef.current) return;
      setLoadedScope({ residentId, facilityId: selectedFacilityId });
      setDetail(row);
      setNotFound(!row);
    } catch (loadError) {
      if (requestVersion !== requestVersionRef.current) return;
      setDetail(null);
      setError(
        formatLiveDataLoadError(
          loadError,
          "Live resident profile is unavailable right now.",
        ),
      );
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false);
    }
  }, [initialFacilityId, residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [load]);

  // The overview already owns this exact header. Child routes inherit it here,
  // so the resident identity and tabs remain mounted while their content swaps.
  if (selectedSegment == null) return children;

  const visibleDetail = scopeMatches ? detail : null;
  const showContent = scopeMatches && !notFound;
  const subtitle = visibleDetail
    ? `${visibleDetail.ageYears != null ? `Age ${visibleDetail.ageYears}` : "Age pending"} · ${formatResidentOverviewGenderLabel(visibleDetail.gender)} · Room ${visibleDetail.roomLabel} · Admitted ${visibleDetail.admissionLabel}`
    : "";

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-4 pt-2">
      {/* Keep the tab subtree in the same position when header data recovers. */}
      {visibleDetail ? (
        <RecordDetailHeader
          title={visibleDetail.fullName}
          subtitle={subtitle}
          backLink={{ label: "Resident roster", href: hrefs.rosterHref }}
          statusChips={
            !isPresenceStatus(visibleDetail.rawStatus) ? (
              <StatusPill tone="muted">{lifecycleStatusLabel(visibleDetail.rawStatus)}</StatusPill>
            ) : visibleDetail.status !== "active" ? (
              <StatusPill tone={presenceTone(visibleDetail.status)}>
                {presenceLabel(visibleDetail.status)}
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
        <div className="space-y-4">
          <Link
            prefetch={false}
            href={hrefs.rosterHref}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
          >
            ← Resident roster
          </Link>
          {loading || (!scopeMatches && !error) ? <AdminTableLoadingState /> : null}
          {scopeMatches && notFound ? (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-xl">Resident not found</CardTitle>
                <CardDescription>
                  This profile may be outside your facility filter or the link is invalid.
                  Adjust your facility filter or return to the resident roster.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {error ? (
            <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
          ) : null}
        </div>
      )}

      {showContent ? (
        <div className="w-full shrink-0">
          <ResidentDetailTabStrip hrefs={hrefs} active={activeTab} />
        </div>
      ) : null}

      <div className="min-w-0">{showContent ? children : null}</div>

      {visibleDetail ? (
        <>
          <BehaviorLogModal
            open={behaviorModalOpen}
            onOpenChange={setBehaviorModalOpen}
            residentId={residentId}
            residentName={visibleDetail.fullName}
            onSuccess={() => void load()}
          />
          <ConditionLogModal
            open={conditionModalOpen}
            onOpenChange={setConditionModalOpen}
            residentId={residentId}
            residentName={visibleDetail.fullName}
            onSuccess={() => void load()}
          />
          <GeneralNoteModal
            open={generalNoteModalOpen}
            onOpenChange={setGeneralNoteModalOpen}
            residentId={residentId}
            residentName={visibleDetail.fullName}
            onSuccess={() => void load()}
          />
        </>
      ) : null}
    </div>
  );
}
