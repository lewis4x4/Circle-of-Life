"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { buildLevelEffects, type LevelEffectRow } from "@/lib/care-events/taxonomy-packet";
import { fetchPrintFacility, type PrintFacility } from "@/lib/care-events/print-data";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE } from "@/lib/supabase/env";

import { PrintGate } from "./PrintGate";
import { TaxonomyPacketSheet } from "./TaxonomyPacketSheet";

/**
 * `/admin/settings/care-events/taxonomy-packet` — owner and org_admin only,
 * which `care_event_print_record` enforces before anything renders.
 *
 * "What fires at each level" is read from the facility's own escalation and
 * follow-up rows, so the packet describes the configuration that is running
 * rather than the one the spec proposed.
 */
export function TaxonomyPacketPageClient() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [facility, setFacility] = useState<PrintFacility | null>(null);
  const [effects, setEffects] = useState<LevelEffectRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const validFacility = UUID_STRING_RE.test(selectedFacilityId ?? "");

  useEffect(() => {
    if (!validFacility || !selectedFacilityId) return;
    let cancelled = false;
    (async () => {
      try {
        const loadedFacility = await fetchPrintFacility(supabase, selectedFacilityId);
        const [policies, protocols] = await Promise.all([
          supabase
            .from("care_event_escalation_policies")
            .select("level, step, after_minutes, target_kind, channels, ack_within_minutes, notification_route_id")
            .eq("is_active", true),
          supabase
            .from("incident_followup_protocols")
            .select("kind, min_level, task_type, description, due_offset_minutes, requires_flag")
            .eq("is_active", true)
            .is("deleted_at", null),
        ]);
        if (policies.error) throw policies.error;
        if (protocols.error) throw protocols.error;

        // Route names live on notification_routes; a route the caller cannot
        // read prints as "Configured route" rather than failing the packet.
        const routeIds = [...new Set((policies.data ?? []).map((row) => row.notification_route_id).filter((id): id is string => Boolean(id)))];
        const routes = routeIds.length > 0 ? await supabase.from("notification_routes").select("id, name").in("id", routeIds) : { data: [], error: null };
        if (routes.error) throw routes.error;
        const routeNames = new Map((routes.data ?? []).map((row) => [row.id, row.name] as const));

        if (cancelled) return;
        setFacility(loadedFacility);
        setEffects(
          buildLevelEffects({
            policies: (policies.data ?? []).map((row) => ({
              level: row.level,
              step: row.step,
              after_minutes: row.after_minutes,
              target_kind: row.target_kind,
              channels: row.channels,
              ack_within_minutes: row.ack_within_minutes,
              route_name: row.notification_route_id ? (routeNames.get(row.notification_route_id) ?? null) : null,
            })),
            protocols: protocols.data ?? [],
          }),
        );
      } catch {
        if (!cancelled) setLoadError("The packet's configuration could not be read. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedFacilityId, validFacility]);

  if (!validFacility) {
    return (
      <div className="p-6">
        <FacilityGateNotice
          title="Care event taxonomy packet"
          reason="The packet prints one building's escalation levels and follow-up rules, so it is printed per building."
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 p-6">
        <p role="alert" className="text-base font-medium text-destructive">
          {loadError}
        </p>
        <Link href="/admin/incidents" className="text-sm underline-offset-4 hover:underline">
          Back to the incidents board
        </Link>
      </div>
    );
  }

  return (
    <PrintGate supabase={supabase} kind="taxonomy_packet" facilityId={selectedFacilityId}>
      {facility === null || effects === null ? (
        <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Building the packet
        </p>
      ) : (
        <TaxonomyPacketSheet facility={facility} effects={effects} />
      )}
    </PrintGate>
  );
}
