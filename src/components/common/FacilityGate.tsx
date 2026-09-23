"use client";

import { Building2, Loader2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useApplyFacilityScope } from "@/hooks/useApplyFacilityScope";
import { useFacilityStore, type Facility } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { singleFacilityDefault } from "@/lib/facilities/single-facility-default";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

/**
 * COL-651: the one way a page says "this needs a single facility".
 *
 * Owners land on "All facilities". A page whose records only exist per
 * building renders `<FacilityGate>` around its body: under All facilities it
 * shows the page title, why the page needs one facility, and an inline picker
 * that sets the same global scope as the header (store + cookie + refresh), so
 * choosing a facility opens the page in place. Nothing inside the gate —
 * KPIs, forms, create buttons — renders until a facility is chosen.
 *
 * Server-rendered pages pass the facility they resolved from the scope cookie
 * as `facilityId`; client pages omit it and the gate reads the store.
 *
 * Do not write another "Select a facility" banner. `FacilityGate.guard.test.ts`
 * fails the build on new gate copy outside this component.
 */

export type FacilityGateScope = {
  /** The facility the page may query, or `null` while gated. */
  facilityId: string | null;
  ready: boolean;
};

/** The scope a gated page renders for: the server's cookie value when given, else the store. */
export function useFacilityGateScope(facilityId?: string | null): FacilityGateScope {
  const storeFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const scope = facilityId === undefined ? storeFacilityId : facilityId;
  const ready = isValidFacilityIdForQuery(scope);
  return { facilityId: ready ? scope : null, ready };
}

/** Facilities the signed-in user can open, from the header's cache or (no shell) a direct read. */
function useGateFacilities(): { facilities: Facility[]; loading: boolean; failed: boolean } {
  const { user, loading: authLoading } = useHavenAuth();
  const userId = user?.id ?? null;
  const cached = useFacilityStore((s) => s.availableFacilities);
  const cacheUserId = useFacilityStore((s) => s.facilitiesCacheUserId);
  const setAvailableFacilities = useFacilityStore((s) => s.setAvailableFacilities);
  const facilities = useMemo(
    () => (userId != null && cacheUserId === userId ? cached : []),
    [cacheUserId, cached, userId],
  );
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    // The header refreshes this list; a page with no shell has nobody else to.
    if (authLoading || userId == null || facilities.length > 0 || requestedFor.current === userId) return;
    requestedFor.current = userId;
    setStatus("loading");
    // Inside the chain, so a throw or a non-promise return lands in catch
    // instead of crashing the page's render.
    Promise.resolve()
      .then(() => fetchAdminFacilityOptions())
      .then((list) => {
        if (list.length > 0) setAvailableFacilities(list, userId);
        setStatus("done");
      })
      .catch(() => setStatus("failed"));
  }, [authLoading, facilities.length, setAvailableFacilities, userId]);

  const loading =
    authLoading || (userId != null && facilities.length === 0 && (status === "idle" || status === "loading"));
  return { facilities, loading, failed: status === "failed" };
}

export type FacilityGateNoticeProps = {
  /** The page's own title. Omit only when the page already renders its heading above the gate. */
  title?: string;
  /** One sentence: why this page is kept per facility. */
  reason: string;
};

/** The gate's body on its own — for pages that must keep their header and filters outside the gate. */
export function FacilityGateNotice({ title, reason }: FacilityGateNoticeProps) {
  const headingId = useId();
  const { facilities, loading, failed } = useGateFacilities();
  const { applyFacilityScope, pending } = useApplyFacilityScope();
  const [choosing, setChoosing] = useState<string | null>(null);

  // A single-building user has nothing to choose: open their building, the
  // same default the header applies. Once per mount, so a server page still
  // rendering the old cookie cannot turn this into a refresh loop.
  const defaultId = singleFacilityDefault(facilities, null);
  const defaulted = useRef(false);
  useEffect(() => {
    if (!defaultId || defaulted.current) return;
    defaulted.current = true;
    applyFacilityScope(defaultId);
  }, [applyFacilityScope, defaultId]);

  const choose = (id: string) => {
    if (applyFacilityScope(id)) setChoosing(id);
  };
  const choosingName = choosing ? facilities.find((f) => f.id === choosing)?.name : undefined;

  return (
    <section data-testid="facility-gate" aria-labelledby={title ? headingId : undefined} className="space-y-4">
      {title ? (
        <h1 id={headingId} className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      ) : null}
      <div className="rounded-[var(--radius)] border border-border bg-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Choose a facility to open this page</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{reason}</p>
            </div>
            {loading ? (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground" role="status">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading your facilities…
              </p>
            ) : facilities.length > 0 ? (
              <div role="group" aria-label="Facilities" className="flex flex-wrap gap-2">
                {facilities.map((facility) => (
                  <Button
                    key={facility.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => choose(facility.id)}
                  >
                    {facility.name}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground" role="status">
                {failed
                  ? "Your facilities could not be loaded. Use the facility selector in the header."
                  : "Your account has no facility access yet. Ask an administrator to grant one."}
              </p>
            )}
            {pending && choosingName ? (
              <p className="text-[12px] text-muted-foreground" role="status">
                Opening {choosingName}…
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">This also sets the facility in the header.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export type FacilityGateProps = FacilityGateNoticeProps & {
  /** Server-resolved scope (cookie). Omit on client pages to read the header's store. */
  facilityId?: string | null;
  children: ReactNode;
};

/** Renders `children` only once a single facility is in scope; otherwise the gate. */
export function FacilityGate({ facilityId, children, ...notice }: FacilityGateProps) {
  const { ready } = useFacilityGateScope(facilityId);
  return ready ? <>{children}</> : <FacilityGateNotice {...notice} />;
}
