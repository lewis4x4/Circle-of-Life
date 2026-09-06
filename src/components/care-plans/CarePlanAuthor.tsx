"use client";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
type Item = {
    category: string;
    title: string;
    description: string;
    assistance_level: string;
    frequency: string;
    goal: string;
    interventions: string[];
    special_instructions: string;
};
const categories = ["mobility", "bathing", "dressing", "grooming", "toileting", "eating", "medication_assistance", "behavioral", "fall_prevention", "skin_integrity", "pain_management", "cognitive", "social", "dietary", "other"];
const blank = (): Item => ({ category: "", title: "", description: "", assistance_level: "", frequency: "", goal: "", interventions: [], special_instructions: "" });
export function CarePlanAuthor({ residentId, previousId, initialItems, onSaved }: {
    residentId: string;
    previousId?: string;
    initialItems: Array<Partial<{
        [K in keyof Item]: Item[K] | null;
    }>>;
    onSaved: () => void;
}) {
    const { appRole } = useHavenAuth();
    const client = useMemo(() => createClient(), []);
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<Item[]>([]);
    const [effective, setEffective] = useState("");
    const [review, setReview] = useState("");
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [requestId, setRequestId] = useState("");
    function begin() { setItems(initialItems.length ? initialItems.map(item => ({ category: item.category ?? "", title: item.title ?? "", description: item.description ?? "", assistance_level: item.assistance_level ?? "", frequency: item.frequency ?? "", goal: item.goal ?? "", interventions: item.interventions ?? [], special_instructions: item.special_instructions ?? "" })) : [blank()]); setRequestId(crypto.randomUUID()); setOpen(true); }
    async function save() { if (busy)
        return; setBusy(true); setError(null); try {
        const result = await client.rpc("create_care_plan_revision_review" as never, { p_id: requestId, p_resident_id: residentId, p_previous_id: previousId ?? null, p_effective: effective, p_review: review, p_notes: notes, p_items: items } as never);
        if (result.error)
            throw result.error;
        if (typeof result.data !== "string")
            throw new Error("Care-plan draft was not acknowledged");
        setOpen(false);
        onSaved();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Care plan was not saved");
    }
    finally {
        setBusy(false);
    } }
    function patch(index: number, key: keyof Item, value: Item[keyof Item]) { setItems(prior => prior.map((item, i) => i === index ? { ...item, [key]: value } : item)); }
    if (!["owner", "org_admin", "facility_admin", "nurse"].includes(appRole ?? "")) return null;
    if (!open)
        return <Button onClick={begin}>{previousId ? "Revise care plan" : "Start care plan"}</Button>;
    return <section className="space-y-3 rounded border border-border p-4"><fieldset disabled={busy} className="contents"><h2 className="text-lg font-semibold">{previousId ? "Care-plan revision" : "New care plan"}</h2><p>Save a new version for clinical review. The current signed plan stays in effect until the new version is approved.</p><label>Effective date<input type="date" value={effective} onChange={e => setEffective(e.target.value)} className="m-2 rounded border p-2"/></label><label>Review due<input type="date" value={review} onChange={e => setReview(e.target.value)} className="m-2 rounded border p-2"/></label>{items.map((item, index) => <fieldset key={index} className="space-y-2 rounded border p-3"><legend>Need / intervention {index + 1}</legend><label>Category<select value={item.category} onChange={e => patch(index, "category", e.target.value)} className="block w-full rounded border p-2"><option value="">Choose category</option>{categories.map(c => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}</select></label>{(["title", "description", "frequency", "goal", "special_instructions"] as const).map(key => <label className="block" key={key}>{key.replaceAll("_", " ")}<input value={item[key]} onChange={e => patch(index, key, e.target.value)} className="block w-full rounded border p-2"/></label>)}<label>Assistance level<select value={item.assistance_level} onChange={e => patch(index, "assistance_level", e.target.value)} className="block w-full rounded border p-2"><option value="">Choose support</option>{["independent", "supervision", "limited_assist", "extensive_assist", "total_dependence"].map(a => <option value={a} key={a}>{a.replaceAll("_", " ")}</option>)}</select></label><label>Interventions (one per line)<textarea value={item.interventions.join("\n")} onChange={e => patch(index, "interventions", e.target.value.split("\n"))} className="block w-full rounded border p-2"/></label><Button variant="outline" onClick={() => setItems(prior => prior.filter((_, i) => i !== index))}>Remove from this revision</Button></fieldset>)}<Button variant="outline" onClick={() => setItems(prior => [...prior, blank()])}>Add need</Button><label className="block">Reason for revision<textarea value={notes} onChange={e => setNotes(e.target.value)} className="block w-full rounded border p-2"/></label>{error && <p role="alert">{error}</p>}<Button disabled={busy || !effective || !review || !items.length || items.some(i => !i.category || !i.title.trim() || !i.description.trim() || !i.assistance_level)} onClick={() => void save()}>{busy ? "Saving…" : "Save for clinical review"}</Button></fieldset></section>;
}
