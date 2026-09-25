"use client";
import { formatDisplayDateTime } from "@/lib/format/datetime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { formatAssignmentInterval } from "@/lib/schedules/assignment-context";
import { currentShiftFor } from "@/lib/caregiver/shift";
import { Button } from "@/components/ui/button";
type Note = { schedule_preset_name?: string | null; schedule_starts_at?: string | null; schedule_ends_at?: string | null; schedule_time_zone?: string | null;
    id: string;
    note: string;
    priority: string;
    created_at: string;
    shift: string;
    acknowledged_at: string | null;
    created_by: string | null;
    resident_id: string | null;
};
export function ShiftHandoffBoard() {
    const client = useMemo(() => createClient(), []);
    const [rows, setRows] = useState<Note[]>([]);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => { try {
        const scope = await loadCaregiverFacilityContext(client);
        if (!scope.ok)
            throw new Error(scope.error);
        const result = await client.from("shift_handoff_notes" as never).select("id,note,priority,created_at,shift,acknowledged_at,created_by,resident_id,schedule_preset_name,schedule_starts_at,schedule_ends_at,schedule_time_zone").eq("facility_id", scope.ctx.facilityId).is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
        if (result.error)
            throw result.error;
        setRows((result.data ?? []) as unknown as Note[]);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Handoff unavailable");
    } }, [client]);
    useEffect(() => { void load(); }, [load]);
    async function save(id?: string) { if (busy)
        return; setBusy(true); setError(null); try {
        const { data: { user } } = await client.auth.getUser();
        if (!user)
            throw new Error("Sign in again.");
        if (id) {
            const result = await client.from("shift_handoff_notes" as never).update({ acknowledged_by: user.id, acknowledged_at: new Date().toISOString(), updated_by: user.id } as never).eq("id", id).is("acknowledged_at", null).select("id").single();
            if (result.error)
                throw result.error;
        }
        else {
            const scope = await loadCaregiverFacilityContext(client);
            if (!scope.ok)
                throw new Error(scope.error);
            if (!draft.trim())
                throw new Error("Enter a handoff note.");
            const current = currentShiftFor(scope.ctx);
            const result = await client.from("shift_handoff_notes" as never).insert({ facility_id: scope.ctx.facilityId, organization_id: scope.ctx.organizationId, shift_date: current.serviceDate, shift: current.shiftType, note: draft.trim(), priority: "normal", category: "other", created_by: user.id } as never).select("id").single();
            if (result.error)
                throw result.error;
            setDraft("");
        }
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Handoff was not saved");
    }
    finally {
        setBusy(false);
    } }
    return <section className="space-y-3 rounded border border-border p-4"><h2 className="text-lg font-semibold">Shared shift notes</h2><p>Notes posted by the care and office teams in this facility, with incoming acknowledgement.</p>{error && <p role="alert">{error}</p>}<label>Post a shift note<textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="block w-full rounded border bg-background p-3"/></label><Button disabled={busy || !draft.trim()} onClick={() => void save()}>Post handoff note</Button>{rows.map(row => <article key={row.id} className="space-y-2 rounded border p-3"><p>{row.note}</p><p className="text-xs">{row.schedule_preset_name && row.schedule_starts_at && row.schedule_ends_at && row.schedule_time_zone ? formatAssignmentInterval({ label: row.schedule_preset_name, starts_at: row.schedule_starts_at, ends_at: row.schedule_ends_at, time_zone: row.schedule_time_zone }) : row.shift} · {formatDisplayDateTime(row.created_at)} · {row.priority}</p>{row.resident_id && <a href={`/caregiver/resident/${row.resident_id}`} className="underline">Open resident</a>}{row.acknowledged_at ? <p>Acknowledged {formatDisplayDateTime(row.acknowledged_at)}</p> : <Button disabled={busy} onClick={() => void save(row.id)}>Acknowledge</Button>}</article>)}</section>;
}
