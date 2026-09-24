"use client";

import { formatDisplayDate } from "@/lib/format/datetime";
import { useQuery } from "@tanstack/react-query";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  AGENCY_SUMMARIES_LOADING_COPY,
  AGENCY_SUMMARIES_NO_CONNECTION_COPY,
  connectionStateCopy,
  freshnessDisclosure,
  incompleteSummaryDisclosure,
  isAuthorizationFresh,
  type AgencySummaryConnection,
  type AgencySummaryView,
} from "@/lib/insurance/agency-summaries-page-state";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

/**
 * Agency summaries — what Circle of Life's insurance agency says it holds.
 *
 * Every fact here was authored somewhere else. Haven did not record these
 * policies, cannot edit them, and may be looking at a stale or partial view of
 * them. So the page leads with how old the information is and what is being
 * withheld, before it shows a single policy. A summary that quietly omits
 * withheld records is worse than no page, because it looks complete.
 *
 * Premium is the one number deliberately not converted. It arrives as the source
 * JSON number in the agency's own units; rendering it as Haven money would imply
 * a reconciliation nobody has done.
 */

export { AGENCY_SUMMARIES_LOADING_COPY };

function SummaryTable({ connection }: { connection: AgencySummaryConnection }) {
  if (connection.summaries.length === 0) return null;
  return (
    <HorizontalScroll label="Agency summaries">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-4 font-medium">Covers</th>
            <th className="py-2 pr-4 font-medium">Policy</th>
            <th className="py-2 pr-4 font-medium">Carrier</th>
            <th className="py-2 pr-4 font-medium">Line</th>
            <th className="py-2 pr-4 font-medium">Term</th>
            <th className="py-2 pr-4 font-medium">Premium (as stated)</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {connection.summaries.map((row) => (
            <tr key={row.release_id} className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">{row.mapped_entity_name}</td>
              <td className="py-2 pr-4 font-mono text-xs">{row.summary.policy_number ?? "Not recorded"}</td>
              <td className="py-2 pr-4">{row.summary.carrier ?? "Not recorded"}</td>
              <td className="py-2 pr-4 text-muted-foreground">{row.summary.line_of_business ?? "Not recorded"}</td>
              <td className="py-2 pr-4 font-mono text-xs tabular-nums">
                {formatDisplayDate(row.summary.effective_date, { fallback: "Not posted" })} → {formatDisplayDate(row.summary.expiration_date, { fallback: "Not posted" })}
              </td>
              <td className="py-2 pr-4 tabular-nums">
                {/* Deliberately not Haven's money formatter: this is the agency's
                    number in the agency's units, and formatting it as Haven money
                    would imply a reconciliation nobody has done. */}
                {row.summary.premium === null || row.summary.premium === undefined
                  ? "No amount stated"
                  : row.summary.premium.toLocaleString()}
              </td>
              <td className="py-2 text-muted-foreground">{row.summary.status ?? "Not recorded"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HorizontalScroll>
  );
}

export default function InsuranceAgencySummariesPage() {
  const supabase = createClient();
  const { organizationId, loading: authLoading } = useHavenAuth();

  const { data, isPending, error } = useQuery({
    queryKey: ["insurance", "agency-summaries", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<AgencySummaryView> => {
      // insureflow_receiver_read arrived in migration 448, after
      // src/types/database.ts was last generated, so it is not in the generated
      // Database type. Narrow to the one RPC rather than regenerating the whole
      // file, which would also pull in whatever other branches have in flight.
      const receiverRpc = supabase as unknown as {
        rpc(
          name: "insureflow_receiver_read",
          args: { p_action: string; p_payload: Record<string, never> },
        ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
      const { data: view, error: rpcError } = await receiverRpc.rpc("insureflow_receiver_read", {
        p_action: "list",
        p_payload: {},
      });
      if (rpcError) throw new Error(rpcError.message);
      return view as unknown as AgencySummaryView;
    },
  });

  const loading = authLoading || isPending;
  const connections = data?.connections ?? [];
  const now = new Date();

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Agency summaries</h1>
        <p className="text-sm text-muted-foreground">
          What the insurance agency holds, as the agency reports it. Haven does not author these records and cannot
          edit them here.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {AGENCY_SUMMARIES_LOADING_COPY}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          The agency summaries could not be loaded. Nothing here is current.
        </p>
      ) : null}

      {!loading && !error && connections.length === 0 ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{AGENCY_SUMMARIES_NO_CONNECTION_COPY}</CardContent>
        </Card>
      ) : null}

      {connections.map((connection) => {
        const withheld = incompleteSummaryDisclosure(connection);
        const fresh = isAuthorizationFresh(connection, now);
        return (
          <Card key={connection.id}>
            <CardHeader>
              <CardTitle className="text-base">{connection.name}</CardTitle>
              <CardDescription>{connectionStateCopy(connection.state, connection.enabled)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Age first, deliberately: it qualifies everything below it. */}
              <p
                className={fresh ? "text-sm text-muted-foreground" : "text-sm font-medium text-foreground"}
                data-testid="agency-freshness"
              >
                {freshnessDisclosure(connection, now)}
              </p>

              {withheld ? (
                <p className="text-sm font-medium text-foreground" data-testid="agency-withheld">
                  {withheld}
                </p>
              ) : null}

              {connection.summaries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agency records are visible for this connection.</p>
              ) : (
                <SummaryTable connection={connection} />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
