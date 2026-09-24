"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Loader2 } from "lucide-react";

import { NewShiftSwapRequest } from "./NewShiftSwapRequest";
import { SwapWorkContext } from "@/components/staffing/SwapWorkContext";
import { cancelSwapGroup, confirmSwapParticipation, hasCompleteSwapContext, swapPartyConfirmed, SWAP_CONTEXT_SELECT, type SwapGroupContext } from "@/lib/staffing/shift-swap-groups";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { formatShiftSwapStaffLabel } from "@/lib/admin/shift-swaps/shift-swaps-display-copy";
import { canApproveShiftSwaps } from "@/lib/staffing/shift-swap-access";
import { formatShiftSwapCoveringName } from "@/lib/staffing/shift-swaps-display-copy";
import { createClient } from "@/lib/supabase/client";

type SwapRow = SwapGroupContext & {
  id: string;
  status: string;
  swap_type: string;
  reason: string | null;
  created_at: string;
  requesting_staff_id: string;
  covering_staff_id: string | null;
  requesting_confirmed_at: string | null;
  covering_confirmed_at: string | null;
};

type StaffMini = { id: string; first_name: string | null; last_name: string | null };
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

type MySwap = SwapRow & { side: "requesting" | "covering"; requestingName: string; coveringName: string | null };

const OPEN_STATUSES = new Set(["pending", "claimed"]);

/**
 * The floor app's "my shift swaps" (COL-661 A2). It shows only swaps the
 * signed-in person requests or covers, whatever their role, and lets them
 * confirm their side. Approval, denial and the CSV export stay on the
 * oversight queue at /admin/shift-swaps; roles allowed to approve get a link there.
 */
export function MyShiftSwaps() {
  const supabase = useMemo(() => createClient(), []);
  const { user, appRole, organizationId } = useHavenAuth();
  const [rows, setRows] = useState<MySwap[]>([]);
  const [ownStaffIds, setOwnStaffIds] = useState<string[]>([]);
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const own = (await supabase
        .from("staff" as never)
        .select("id, first_name, last_name")
        .eq("user_id", user.id)
        .is("deleted_at", null)) as unknown as QueryResult<StaffMini>;
      if (own.error) throw own.error;
      const ownIds = (own.data ?? []).map((s) => s.id);
      setOwnStaffIds(ownIds);
      setLinked(ownIds.length > 0);
      if (ownIds.length === 0) {
        setRows([]);
        return;
      }

      const idList = ownIds.join(",");
      const swaps = (await supabase
        .from("shift_swap_requests" as never)
        .select(
          `id, status, swap_type, reason, created_at, requesting_staff_id, covering_staff_id, requesting_confirmed_at, covering_confirmed_at, ${SWAP_CONTEXT_SELECT}`,
        )
        .or(`requesting_staff_id.in.(${idList}),covering_staff_id.in.(${idList})`)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50)) as unknown as QueryResult<SwapRow>;
      if (swaps.error) throw swaps.error;

      const names = new Map<string, StaffMini>((own.data ?? []).map((s) => [s.id, s]));
      const otherIds = [
        ...new Set(
          (swaps.data ?? [])
            .flatMap((r) => [r.requesting_staff_id, r.covering_staff_id])
            .filter((id): id is string => Boolean(id) && !names.has(id as string)),
        ),
      ];
      if (otherIds.length > 0) {
        // Floor roles may only read their own staff row; an unreadable coworker shows as unposted.
        const others = (await supabase
          .from("staff" as never)
          .select("id, first_name, last_name")
          .in("id", otherIds)
          .is("deleted_at", null)) as unknown as QueryResult<StaffMini>;
        for (const s of others.data ?? []) names.set(s.id, s);
      }

      const ownSet = new Set(ownIds);
      setRows(
        (swaps.data ?? []).map((r) => ({
          ...r,
          side: ownSet.has(r.requesting_staff_id) ? "requesting" : "covering",
          requestingName: ownSet.has(r.requesting_staff_id) ? "You" : formatShiftSwapStaffLabel(names.get(r.requesting_staff_id)),
          coveringName: r.covering_staff_id
            ? ownSet.has(r.covering_staff_id)
              ? "You"
              : formatShiftSwapStaffLabel(names.get(r.covering_staff_id))
            : null,
        })),
      );
    } catch (err) {
      console.error("[MyShiftSwaps] load failed", err);
      setError("Your shift swaps could not be loaded right now. Try again.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = useCallback(
    async (row: MySwap) => {
      setBusyId(row.id);
      setNotice(null);
      try {
        await confirmSwapParticipation(supabase, row);
        await load();
      } catch (err) {
        console.error("[MyShiftSwaps] confirm failed", err);
        setNotice(err instanceof Error ? err.message : "Your confirmation was not saved. Reload the request and review its current details.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, load],
  );

  async function cancelGroup(row: MySwap) {
    if (busyId || row.swap_scope !== "group" || !OPEN_STATUSES.has(row.status)) return;
    setBusyId(row.id); setNotice(null);
    try { await cancelSwapGroup(supabase, row.id); await load(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "The request could not be cancelled."); }
    finally { setBusyId(null); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-12">
      <Link href="/caregiver/schedules" className="text-sm underline">
        Back to my schedule
      </Link>
      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ArrowLeftRight className="h-5 w-5 text-primary" aria-hidden />
            My shift swaps
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Swaps you asked for or were asked to cover. Confirm your side; a manager approves the change to the schedule.
          </CardDescription>
          {canApproveShiftSwaps(appRole) ? (
            <Link href="/admin/shift-swaps" className="text-sm underline">
              Open the approval queue
            </Link>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {!loading && !error && linked && <NewShiftSwapRequest key={user?.id} ownStaffIds={ownStaffIds} organizationId={organizationId || ""} onCreated={load} />}
          {notice ? (
            <p role="alert" className="text-sm text-warning">
              {notice}
            </p>
          ) : null}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading your shift swaps" />
            </div>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : !linked ? (
            <p role="status" className="text-sm text-muted-foreground">
              Your sign-in is not linked to a staff record yet, so there are no swaps to show. Ask your administrator to link it.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no shift swaps.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => {
                const myConfirmed = swapPartyConfirmed(row, row.side);
                const open = OPEN_STATUSES.has(row.status.toLowerCase());
                return (
                  <li key={row.id} className="space-y-2 rounded-[var(--radius)] border border-border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {row.requestingName} → {formatShiftSwapCoveringName(row.coveringName)}
                      </span>
                      <StatusPill tone={row.status === "denied" ? "danger" : open ? "warning" : "muted"}>{row.status}</StatusPill>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      · {row.swap_type}
                      {row.reason ? ` · ${row.reason}` : ""}
                    </p>
                    <SwapWorkContext row={row} />
                    {open ? (
                      myConfirmed ? (
                        <p className="text-xs text-muted-foreground">You confirmed. Waiting on the other person and a manager.</p>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={busyId !== null || !hasCompleteSwapContext(row)} onClick={() => void confirm(row)}>
                          {busyId === row.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
                          {row.swap_scope === "group" ? "Confirm every block in this group" : "Confirm my participation"}
                        </Button>
                      )
                    ) : null}
                    {open && row.swap_scope === "group" && <Button type="button" size="sm" variant="ghost" disabled={busyId !== null} onClick={() => void cancelGroup(row)}>Cancel group request</Button>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
