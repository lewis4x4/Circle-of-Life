"use client";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
export function MedicationErrorReview({ id, onSaved }: {
    id: string;
    onSaved: () => void;
}) {
    const { appRole } = useHavenAuth();
    const client = useMemo(() => createClient(), []);
    const [open, setOpen] = useState(false);
    const [description, setDescription] = useState("");
    const [cause, setCause] = useState("");
    const [actions, setActions] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    async function begin() { const result = await client.from("medication_errors").select("description,immediate_actions,root_cause,corrective_actions").eq("id", id).is("deleted_at", null).single(); if (result.error) {
        setError(result.error.message);
        return;
    } setDescription(`${result.data.description}\nImmediate actions: ${result.data.immediate_actions}`); setCause(result.data.root_cause ?? ""); setActions(result.data.corrective_actions ?? ""); setOpen(true); }
    async function save() { setBusy(true); setError(null); try {
        const { data: { user } } = await client.auth.getUser();
        if (!user)
            throw new Error("Sign in again");
        const result = await client.from("medication_errors").update({ root_cause: cause, corrective_actions: actions, reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_by: user.id }).eq("id", id).is("reviewed_at", null).select("id").single();
        if (result.error)
            throw result.error;
        setOpen(false);
        onSaved();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Review not saved");
    }
    finally {
        setBusy(false);
    } }
    if (!["owner", "org_admin", "facility_admin", "nurse"].includes(appRole ?? "")) return null;
    return <div><fieldset disabled={busy} className="contents">{error && <p role="alert">{error}</p>}{open ? <div className="space-y-2 rounded border p-3"><p className="whitespace-pre-wrap">{description}</p><label>Root cause<textarea value={cause} onChange={e => setCause(e.target.value)} className="block w-full rounded border p-2"/></label><label>Corrective actions<textarea value={actions} onChange={e => setActions(e.target.value)} className="block w-full rounded border p-2"/></label><Button disabled={busy || !cause.trim() || !actions.trim()} onClick={() => void save()}>Sign clinical review</Button></div> : <Button variant="outline" onClick={() => void begin()}>Review medication error</Button>}</fieldset></div>;
}
