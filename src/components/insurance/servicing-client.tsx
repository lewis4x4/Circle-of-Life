"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { Button } from "@/components/ui/button";
import { InsuranceHubNav } from "@/app/(admin)/insurance/insurance-hub-nav";
import type {
  ServicingKind,
  ServicingWorkspace,
} from "@/lib/insurance/servicing-types";
import { insuranceRequest, panelClass } from "./workspace-client";

export const SERVICING_LABELS: Record<ServicingKind, string> = {
  renewal_package: "Renewal packages",
  vendor_evidence: "Vendor certificate evidence",
  loss_report: "Loss reports",
  claim_matter: "Insurance matters",
  workforce_exposure: "Workforce exposures",
};
export function servicingCommand<T>(action: string, payload: unknown) {
  return insuranceRequest<T>("/api/insurance/servicing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
}
export function useServicingWorkspace() {
  const auth = useHavenAuth();
  const allowed =
    !auth.loading && ["owner", "org_admin"].includes(auth.appRole);
  const key = `${auth.organizationId}:${auth.user?.id}:${auth.appRole}`;
  const [result, setResult] = useState<{
    key: string;
    data?: ServicingWorkspace;
    error?: string;
  }>({ key: "" });
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((v) => v + 1), []);
  useEffect(() => {
    if (!allowed || !auth.organizationId) return;
    const controller = new AbortController();
    insuranceRequest<ServicingWorkspace>("/api/insurance/servicing", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Insurance servicing is unavailable.",
          });
      });
    return () => controller.abort();
  }, [allowed, auth.organizationId, key, reload]);
  const current = allowed && result.key === key ? result : null;
  return { auth, allowed, data: current?.data, error: current?.error, refresh };
}
export function ServicingShell({
  title,
  state,
  children,
}: {
  title: string;
  state: ReturnType<typeof useServicingWorkspace>;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6 pb-12">
      <InsuranceHubNav />
      <header>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prepare, review and preserve insurance servicing records. Sharing and
          acknowledgment record actions performed by an authorized person.
        </p>
      </header>
      {state.auth.loading ? (
        <p role="status">Loading insurance profile…</p>
      ) : !state.auth.organizationId ? (
        <p>No organization on this profile</p>
      ) : !state.allowed ? (
        <p className={panelClass}>
          This servicing workspace is restricted to insurance managers. Use your
          approved facility policy summaries and certificate requests.
        </p>
      ) : state.error ? (
        <section className={panelClass}>
          <p role="alert">{state.error}</p>
          <Button onClick={state.refresh}>Retry servicing workspace</Button>
        </section>
      ) : !state.data ? (
        <p role="status">Loading servicing records…</p>
      ) : (
        children
      )}
    </div>
  );
}
export function ServicingContextLink({ kind }: { kind: ServicingKind }) {
  const { loading, appRole } = useHavenAuth();
  if (loading || !["owner", "org_admin"].includes(appRole)) return null;
  return (
    <section className={panelClass}>
      <h2 className="font-semibold">{SERVICING_LABELS[kind]}</h2>
      <p className="text-sm text-muted-foreground">
        Use the reviewed workspace for new records, dated evidence and immutable
        version history.
      </p>
      <Link
        className="text-primary underline"
        href={`/admin/insurance/servicing?kind=${kind}`}
      >
        Open {SERVICING_LABELS[kind].toLowerCase()}
      </Link>
    </section>
  );
}

export function LegacyInsuranceGuard({
  children,
  loadingCopy = "Loading insurance profile…",
}: {
  children: ReactNode;
  loadingCopy?: string;
}) {
  const { loading, organizationId, appRole } = useHavenAuth();
  if (loading)
    return (
      <div className="space-y-5">
        <InsuranceHubNav />
        <p role="status">{loadingCopy}</p>
      </div>
    );
  if (!organizationId)
    return (
      <div className="space-y-5">
        <InsuranceHubNav />
        <p>No organization on this profile</p>
      </div>
    );
  if (!["owner", "org_admin"].includes(appRole))
    return (
      <div className="space-y-5">
        <InsuranceHubNav />
        <p className={panelClass}>
          This insurance register is restricted to insurance managers. Use your
          approved facility policy summaries and certificate requests.
        </p>
      </div>
    );
  return <Fragment key={`${organizationId}:${appRole}`}>{children}</Fragment>;
}

export function incidentChoiceLabel(
  incident: { facility_id: string; incident_type: string; occurred_at: string },
  workspace: ServicingWorkspace,
) {
  const date = new Date(incident.occurred_at);
  return `${Number.isNaN(date.valueOf()) ? "Date unavailable" : date.toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} Eastern · ${incident.incident_type.replaceAll("_", " ")} · ${workspace.facilities.find((f) => f.id === incident.facility_id)?.name || "Facility"}`;
}
