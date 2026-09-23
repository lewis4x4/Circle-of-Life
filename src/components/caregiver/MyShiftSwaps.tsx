"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { formatShiftSwapStaffLabel } from "@/lib/admin/shift-swaps/shift-swaps-display-copy";
import { canApproveShiftSwaps } from "@/lib/staffing/shift-swap-access";
import { formatShiftSwapCoveringName } from "@/lib/staffing/shift-swaps-display-copy";
import { createClient } from "@/lib/supabase/client";

type SwapRow = {
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
  const { user, appRole } = useHavenAuth();
  const [rows, setRows] = useState<MySwap[]>([]);
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
      setLinked(ownIds.length > 0);
      if (ownIds.length === 0) {
        setRows([]);
        return;
      }

      const idList = ownIds.join(",");
      const swaps = (await supabase
        .from("shift_swap_requests" as never)
        .select(
          "id, status, swap_type, reason, created_at, requesting_staff_id, covering_staff_id, requesting_confirmed_at, covering_confirmed_at",
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
    async (id: string) => {
      setBusyId(id);
      setNotice(null);
      try {
        const { error: rpcError } = await supabase.rpc("confirm_shift_swap" as never, { p_id: id } as never);
        if (rpcError) throw rpcError;
        await load();
      } catch (err) {
        console.error("[MyShiftSwaps] confirm failed", err);
        setNotice("Your confirmation was not saved. Try again, or ask your manager.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, load],
  );

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
                const myConfirmed = row.side === "requesting" ? row.requesting_confirmed_at : row.covering_confirmed_at;
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
                    {open ? (
                      myConfirmed ? (
                        <p className="text-xs text-muted-foreground">You confirmed. Waiting on the other person and a manager.</p>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={busyId !== null} onClick={() => void confirm(row.id)}>
                          {busyId === row.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
                          Confirm my participation
                        </Button>
                      )
                    ) : null}
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
