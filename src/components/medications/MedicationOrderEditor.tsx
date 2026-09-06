"use client";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
const routes = ["oral", "sublingual", "topical", "ophthalmic", "otic", "nasal", "inhaled", "rectal", "transdermal", "subcutaneous", "intramuscular", "other"];
const frequencies = ["daily", "bid", "tid", "qid", "qhs", "qam", "prn", "weekly", "biweekly", "monthly", "other"];
export function MedicationOrderEditor({ residentId, medicationId, onSaved }: {
    residentId: string;
    medicationId?: string;
    onSaved: () => void;
}) {
    const { appRole } = useHavenAuth();
    const client = useMemo(() => createClient(), []);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [requestId, setRequestId] = useState("");
    const [reason, setReason] = useState("");
    async function begin() { setError(null); setRequestId(crypto.randomUUID()); if (medicationId) {
        const result = await client.from("resident_medications").select("*").eq("id", medicationId).single();
        if (result.error) {
            setError(result.error.message);
            return;
        }
        const row = result.data;
        setFields({ medication_name: row.medication_name, strength: row.strength ?? "", form: row.form ?? "", end_date: row.end_date ?? "", indication: row.indication ?? "", route: row.route, frequency: row.frequency, scheduled_times: (row.scheduled_times ?? []).join(", "), instructions: row.instructions ?? "", prescriber_name: row.prescriber_name ?? "", order_date: row.order_date, start_date: row.start_date, controlled_schedule: row.controlled_schedule, prn_max_frequency: row.prn_max_frequency ?? "" });
    }
    else
        setFields({}); setOpen(true); }
    async function save(action: "save" | "discontinue") { if (busy)
        return; setBusy(true); setError(null); try {
        const payload = { ...fields, end_date: fields.end_date || null, scheduled_times: (fields.scheduled_times ?? "").split(",").map(v => v.trim()).filter(Boolean) };
        const result = await client.rpc("save_medication_order_review" as never, { p_id: requestId, p_resident_id: residentId, p_previous_id: medicationId ?? null, p_action: action, p_reason: reason, p_order: payload } as never);
        if (result.error)
            throw result.error;
        if (typeof result.data !== "string")
            throw new Error("The order was not acknowledged");
        setOpen(false);
        onSaved();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Order could not be saved");
    }
    finally {
        setBusy(false);
    } }
    const required = ["medication_name", "strength", "route", "frequency", "instructions", "prescriber_name", "order_date", "start_date", "controlled_schedule"];
    if (!["owner", "org_admin", "facility_admin", "nurse"].includes(appRole ?? "")) return null;
    if (!open)
        return <div><Button variant="outline" onClick={() => void begin()}>{medicationId ? "Revise / discontinue" : "Add medication order"}</Button>{error && <p role="alert">{error}</p>}</div>;
    return <section className="space-y-3 rounded border p-4"><fieldset disabled={busy} className="contents"><h3 className="font-semibold">{medicationId ? "Medication order revision" : "Record a medication order"}</h3><p>Transcribe the authorized prescriber order. A revision preserves the prior order and its administrations.</p>{["medication_name", "strength", "form", "indication", "prescriber_name", "order_date", "start_date", "end_date", "scheduled_times", "instructions", "prn_max_frequency"].map(key => <label className="block" key={key}>{key.replaceAll("_", " ")}{key === "scheduled_times" ? " (HH:MM, comma-separated)" : ""}<input type={key.endsWith("date") ? "date" : "text"} value={fields[key] ?? ""} onChange={e => setFields(prior => ({ ...prior, [key]: e.target.value }))} className="block w-full rounded border p-2"/></label>)}{([["route", routes], ["frequency", frequencies], ["controlled_schedule", ["non_controlled", "ii", "iii", "iv", "v"]]] as const).map(([key, options]) => <label className="block" key={key}>{key.replaceAll("_", " ")}<select value={fields[key] ?? ""} onChange={e => setFields(prior => ({ ...prior, [key]: e.target.value }))} className="block w-full rounded border p-2"><option value="">Choose</option>{options.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>)}<label className="block">Order evidence / reason for change<textarea value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded border p-2"/></label>{error && <p role="alert">{error}</p>}<div className="flex gap-3"><Button disabled={busy || !reason.trim() || required.some(key => !fields[key]?.trim())} onClick={() => void save("save")}>Save authorized order</Button>{medicationId && <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => void save("discontinue")}>Discontinue per order</Button>}</div></fieldset></section>;
}
