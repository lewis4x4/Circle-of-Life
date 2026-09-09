"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { InsuranceHubNav } from "@/app/(admin)/insurance/insurance-hub-nav";
import {
  agencySummaryResponseSchema,
  connectionMayDisplay,
  type AgencySummaryResponse,
  type AgencyConnection,
  type AgencySummary,
} from "./agency-summary-contract";
import { panelClass } from "./workspace-client";

type ReadState = {
  key: string;
  startedAt: number;
  data?: AgencySummaryResponse;
  error?: string;
};
function timestamp(value: string | null) {
  return value
    ? new Date(value).toLocaleString("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }) + " Eastern"
    : "Not yet checked";
}
function stated(value: string | number | null) {
  return value === null || value === ""
    ? "Not stated by source"
    : String(value);
}

function AgencyReadFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6 pb-12">
      <InsuranceHubNav />
      <header>
        <h1 className="text-2xl font-semibold">Agency summaries</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Read-only, source-stated InsureFlow releases. These summaries do not
          verify coverage or create Haven policy records.
        </p>
      </header>
      {children}
      <Link
        href="/admin/insurance"
        className="inline-block text-sm text-primary underline"
      >
        Back to insurance overview
      </Link>
    </div>
  );
}
export default function AgencySummariesPage() {
  const auth = useHavenAuth();
  if (auth.loading)
    return (
      <AgencyReadFrame>
        <p role="status">Loading insurance profile…</p>
      </AgencyReadFrame>
    );
  if (!auth.organizationId)
    return (
      <AgencyReadFrame>
        <p>No organization on this profile</p>
      </AgencyReadFrame>
    );
  if (!["owner", "org_admin"].includes(auth.appRole))
    return (
      <AgencyReadFrame>
        <p className={panelClass}>
          Agency summaries are restricted to authorized insurance managers. Your
          approved facility policy summaries remain available in Insurance.
        </p>
      </AgencyReadFrame>
    );
  return (
    <AuthorizedAgencySummaries
      key={`${auth.organizationId}:${auth.user?.id}:${auth.appRole}`}
    />
  );
}
function AuthorizedAgencySummaries() {
  const [read, setRead] = useState<ReadState>({ key: "", startedAt: 0 });
  const [refresh, setRefresh] = useState(0);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [clock, setClock] = useState(() => performance.now());
  const key = String(refresh);
  const current = online && read.key === key ? read : null;
  useEffect(() => {
    const offline = () => setOnline(false);
    const recheck = () => {
      setOnline(navigator.onLine);
      setRefresh((value) => value + 1);
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, []);
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const startedAt = performance.now();
    const fail = (message: string) => {
      if (!controller.signal.aborted)
        setRead({ key, startedAt, error: message });
    };
    fetch("/api/insurance/agency-summaries", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          fail(
            response.status === 401
              ? "Your session changed. Sign in again to view agency summaries."
              : response.status === 403
                ? "Agency summaries are restricted to authorized insurance managers."
                : "Agency summaries are unavailable. Refresh to retry.",
          );
          return;
        }
        const body: unknown = await response.json();
        const parsed = agencySummaryResponseSchema.safeParse(body);
        if (!parsed.success) {
          fail("Agency summaries could not be safely displayed.");
          return;
        }
        if (!controller.signal.aborted) {
          setClock(performance.now());
          setRead({ key, startedAt, data: parsed.data });
        }
      })
      .catch(() => fail("Agency summaries are unavailable. Refresh to retry."));
    return () => controller.abort();
  }, [online, key]);
  useEffect(() => {
    if (!current?.data) return;
    const remaining = current.data.connections
      .filter(connectionMayDisplay)
      .map(
        (connection) =>
          Date.parse(connection.authorization_valid_until!) -
          Date.parse(current.data!.read_at) -
          (performance.now() - current.startedAt),
      )
      .filter((delay) => delay > 0);
    if (!remaining.length) return;
    const timer = setTimeout(
      () => setClock(performance.now()),
      Math.min(Math.min(...remaining) + 1, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [current, clock]);

  return (
    <AgencyReadFrame>
      {!online ? (
        <p role="status" className={panelClass}>
          Agency summaries are unavailable while offline. Reconnect to check
          authorization.
        </p>
      ) : current?.error ? (
        <section className={panelClass}>
          <p role="alert">{current.error}</p>
          <Button onClick={() => setRefresh((value) => value + 1)}>
            Refresh agency summaries
          </Button>
        </section>
      ) : !current?.data ? (
        <p role="status">Checking authorized agency summaries…</p>
      ) : (
        <>
          <section className={panelClass}>
            <h2 className="text-lg font-semibold">Live connection disabled</h2>
            <p className="text-sm">
              This section is limited to local, synthetic verification. No live
              InsureFlow connection is enabled.
            </p>
            <p className="text-sm text-muted-foreground">
              Before live sharing: approve the staging connection, exact
              account-to-entity mappings, authorized readers, authorization
              freshness and withdrawal timing, and retention policy.
            </p>
            <Button
              variant="outline"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Refresh agency summaries
            </Button>
          </section>
          {!current.data.connections.length ? (
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">
                No agency summaries available
              </h2>
              <p className="text-sm">
                No synthetic receiver connection has been configured for this
                organization. This does not mean the organization has no
                insurance.
              </p>
              <Link
                className="text-primary underline"
                href="/admin/insurance/policies"
              >
                Open Haven policy register
              </Link>
            </section>
          ) : (
            current.data.connections.map((connection) => {
              const fresh =
                connectionMayDisplay(connection) &&
                Date.parse(connection.authorization_valid_until!) -
                  Date.parse(current.data!.read_at) >
                  clock - current.startedAt;
              return (
                <ConnectionSummary
                  key={connection.id}
                  connection={connection}
                  fresh={fresh}
                />
              );
            })
          )}
        </>
      )}
    </AgencyReadFrame>
  );
}

function ConnectionSummary({
  connection,
  fresh,
}: {
  connection: AgencyConnection;
  fresh: boolean;
}) {
  const disabled = !connection.enabled || connection.state === "disabled";
  const status = disabled
    ? "Disabled"
    : !fresh
      ? "Authorization unavailable or expired"
      : connection.state === "degraded"
        ? "Degraded — some summaries unavailable"
        : "Authorization current";
  return (
    <section className={panelClass}>
      <div>
        <h2 className="text-xl font-semibold">{connection.name}</h2>
        <p className="mt-1 text-sm">Synthetic connection · {status}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Last authorization check">
          {timestamp(connection.last_authorization_check_at)}
        </Detail>
        <Detail label="Authorization valid until">
          {connection.authorization_valid_until
            ? timestamp(connection.authorization_valid_until)
            : "Not established"}
        </Detail>
        <Detail label="Summary completeness">
          {connection.last_authorization_check_at === null
            ? "Not yet established"
            : connection.incomplete_summary_count > 0
              ? `${connection.incomplete_summary_count} source ${connection.incomplete_summary_count === 1 ? "summary" : "summaries"} unavailable; recovery is incomplete.`
              : "No unavailable source summaries reported by this check."}
        </Detail>
        <Detail label="Source instance">{connection.provider_instance}</Detail>
      </dl>
      {disabled ? (
        <p className="text-sm">
          Sharing is disabled for this connection. Source summaries are hidden.
        </p>
      ) : !fresh ? (
        <p className="text-sm">
          Summaries are hidden until a current authorization check succeeds.
          Previously received summaries are not shown.
        </p>
      ) : (
        <>
          {connection.state === "degraded" && (
            <p className="rounded-lg border border-border bg-muted p-3 text-sm">
              Only available, currently authorized releases appear below. An
              unavailable source summary does not fall back to an older summary.
            </p>
          )}
          {!connection.summaries.length ? (
            <p className="text-sm">
              No currently authorized summaries are available. This is not a
              statement about insurance coverage.
            </p>
          ) : (
            connection.summaries.map((summary) => (
              <SourceSummary key={summary.release_id} item={summary} />
            ))
          )}
        </>
      )}
      <details className="border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Connection provenance
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Detail label="Receiver connection">{connection.id}</Detail>
          <Detail label="Source integration">
            {connection.source_integration_id}
          </Detail>
        </dl>
      </details>
    </section>
  );
}
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm">{children}</dd>
    </div>
  );
}
function SourceSummary({ item }: { item: AgencySummary }) {
  const source = item.summary;
  return (
    <article className="space-y-4 rounded-lg border border-border p-4">
      <header>
        <h3 className="font-semibold">{stated(source.policy_number)}</h3>
        <p className="text-sm text-muted-foreground">
          Source-stated summary · mapped to {item.mapped_entity_name}
        </p>
      </header>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Carrier — source stated">
          {stated(source.carrier)}
        </Detail>
        <Detail label="Line of business — source stated">
          {stated(source.line_of_business)}
        </Detail>
        <Detail label="Named insured — source wording">
          {stated(source.named_insured)}
        </Detail>
        <Detail label="Effective date — source stated">
          {stated(source.effective_date)}
        </Detail>
        <Detail label="Expiration date — source stated">
          {stated(source.expiration_date)}
        </Detail>
        <Detail label="Status — source description">
          {stated(source.status)}
        </Detail>
        <Detail label="Premium — source number">
          {stated(source.premium)}
        </Detail>
      </dl>
      <p className="text-sm text-muted-foreground">
        Premium currency, units and period basis are unconfirmed. The source
        number is shown without conversion or inclusion in financial totals.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          Release provenance
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Detail label="Released by source">
            {timestamp(item.source_released_at)}
          </Detail>
          <Detail label="Received by Haven">
            {timestamp(item.received_at)}
          </Detail>
          <Detail label="Source policy reference">
            {item.source_policy_id}
          </Detail>
          <Detail label="Release reference">{item.release_id}</Detail>
          <Detail label="Source sequence">{item.source_sequence}</Detail>
          <Detail label="Approved mapped entity">
            {item.mapped_entity_name} · {item.mapped_entity_id}
          </Detail>
        </dl>
      </details>
    </article>
  );
}
