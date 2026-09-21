"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { FAMILY_BULLETIN_ONE_WAY_HELPER } from "@/lib/admin/family-messages-copy";
import {
  type FamilyDeliveryMethod,
} from "@/lib/admin/family-messages-data";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

import { isCurrentAsyncGeneration } from "@/lib/admin/family-bulletin-draft";

import { StaffFamilyNoteComposer } from "./StaffFamilyNoteComposer";

export type BulletinResidentOption = {
  id: string;
  label: string;
};

export type StaffFamilyBulletinSectionProps = {
  residentId: string;
  onResidentChange?: (residentId: string, residentLabel?: string) => void;
  residentOptions?: BulletinResidentOption[];
  lastPostedAtIso?: string | null;
  recipientLabel?: string | null;
  draft: string;
  deliveryMethod: FamilyDeliveryMethod;
  posting?: boolean;
  error?: string | null;
  onDraftChange: (value: string) => void;
  onDeliveryMethodChange: (value: FamilyDeliveryMethod) => void;
  onPost: () => void;
  className?: string;
};

function formatLastPostedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function StaffFamilyBulletinSection({
  residentId,
  onResidentChange,
  residentOptions,
  lastPostedAtIso,
  recipientLabel = null,
  draft,
  deliveryMethod,
  posting = false,
  error,
  onDraftChange,
  onDeliveryMethodChange,
  onPost,
  className,
}: StaffFamilyBulletinSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [roster, setRoster] = useState<{
    facilityId: string;
    options: BulletinResidentOption[];
  } | null>(null);
  const [residentsLoading, setResidentsLoading] = useState(false);
  const [residentsError, setResidentsError] = useState<string | null>(null);
  const rosterGeneration = useRef(0);

  const showResidentPicker = Boolean(onResidentChange);
  const rosterMatchesFacility = roster?.facilityId === selectedFacilityId;
  const residents =
    residentOptions ?? (rosterMatchesFacility && roster ? roster.options : []);
  const awaitingRoster =
    showResidentPicker &&
    !residentOptions &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    !rosterMatchesFacility;
  const rosterRecipient = residents.find((resident) => resident.id === residentId)?.label ?? null;
  const visibleRecipient = recipientLabel?.trim() || rosterRecipient;

  const loadResidents = useCallback(async () => {
    if (!showResidentPicker || residentOptions) return;

    const generation = ++rosterGeneration.current;
    const facilityId = selectedFacilityId;
    setResidentsError(null);

    if (!isValidFacilityIdForQuery(facilityId)) {
      if (isCurrentAsyncGeneration(generation, rosterGeneration.current)) {
        setRoster(null);
        setResidentsLoading(false);
      }
      return;
    }

    setResidentsLoading(true);

    try {
      const { data, error: queryError } = await supabase
        .from("residents")
        .select("id, first_name, last_name, preferred_name")
        .eq("facility_id", facilityId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("last_name")
        .order("first_name")
        .limit(500);

      if (!isCurrentAsyncGeneration(generation, rosterGeneration.current)) return;
      if (queryError) throw queryError;

      const options = (data ?? []).map((resident) => {
        const firstName = resident.preferred_name?.trim() || resident.first_name?.trim() || "";
        const lastName = resident.last_name?.trim() || "";
        const label = [firstName, lastName].filter(Boolean).join(" ") || "Resident";
        return { id: resident.id, label };
      });

      setRoster({ facilityId, options });
    } catch (err) {
      if (!isCurrentAsyncGeneration(generation, rosterGeneration.current)) return;
      setResidentsError(err instanceof Error ? err.message : "Could not load residents.");
      setRoster(null);
    } finally {
      if (isCurrentAsyncGeneration(generation, rosterGeneration.current)) {
        setResidentsLoading(false);
      }
    }
  }, [residentOptions, selectedFacilityId, showResidentPicker, supabase]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  useEffect(() => {
    if (!showResidentPicker || !onResidentChange || residentOptions) return;
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      if (residentId) onResidentChange("");
      return;
    }
    if (roster && roster.facilityId !== selectedFacilityId) {
      if (residentId) onResidentChange("");
      return;
    }
    if (residentsLoading || !roster) return;
    if (residentId && !roster.options.some((resident) => resident.id === residentId)) {
      onResidentChange("");
    }
  }, [
    onResidentChange,
    residentId,
    residentOptions,
    residentsLoading,
    roster,
    selectedFacilityId,
    showResidentPicker,
  ]);

  const handleResidentChange = (nextResidentId: string) => {
    const selected = residents.find((resident) => resident.id === nextResidentId);
    onResidentChange?.(nextResidentId, selected?.label);
  };

  return (
    <section
      aria-label="Post family portal bulletin"
      className={cn("space-y-4", className)}
    >
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Post a bulletin note</h2>
          <p className="text-sm text-muted-foreground">{FAMILY_BULLETIN_ONE_WAY_HELPER}</p>
          {lastPostedAtIso ? (
            <p className="text-xs text-muted-foreground">
              Last posted {formatLastPostedAt(lastPostedAtIso)}
            </p>
          ) : residentId ? (
            <p className="text-xs text-muted-foreground">No bulletin notes posted for this resident yet.</p>
          ) : null}
        </div>

        {showResidentPicker ? (
          <div className="mt-4 space-y-2">
            <label htmlFor="family-bulletin-resident" className="text-xs font-medium text-foreground">
              Resident
            </label>
            {residentsLoading || awaitingRoster ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading residents…
              </div>
            ) : residentsError ? (
              <p role="alert" className="text-xs text-destructive">
                {residentsError}
              </p>
            ) : (
              <select
                id="family-bulletin-resident"
                value={residentId}
                disabled={posting}
                onChange={(event) => handleResidentChange(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select a resident…</option>
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.label}
                  </option>
                ))}
              </select>
            )}
            {!residentsLoading && residents.length === 0 && !residentsError ? (
              <p className="text-xs text-muted-foreground">
                No active residents in the selected facility scope.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <StaffFamilyNoteComposer
        draft={draft}
        deliveryMethod={deliveryMethod}
        recipientLabel={visibleRecipient}
        posting={posting}
        disabled={!residentId}
        error={error}
        onDraftChange={onDraftChange}
        onDeliveryMethodChange={onDeliveryMethodChange}
        onPost={onPost}
      />
      {!residentId ? (
        <p className="text-xs text-muted-foreground">Select a resident to enable posting.</p>
      ) : null}
    </section>
  );
}
