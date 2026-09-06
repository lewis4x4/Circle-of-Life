"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { Database } from "@/types/database";
type Order = Database["public"]["Tables"]["verbal_orders"]["Row"];
export default function VerbalOrderDetail() {
    const { id } = useParams<{
        id: string;
    }>();
    const client = useMemo(() => createClient(), []);
    const [order, setOrder] = useState<Order | null>(null);
    const [meds, setMeds] = useState<{
        id: string;
        medication_name: string;
        status: string;
    }[]>([]);
    const [evidence, setEvidence] = useState("");
    const [signedDate, setSignedDate] = useState("");
    const [medicationId, setMedicationId] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => { const result = await client.from("verbal_orders").select("*").eq("id", id).is("deleted_at", null).single(); if (result.error) {
        setError(result.error.message);
        return;
    } setOrder(result.data); const medicationResult = await client.from("resident_medications").select("id,medication_name,status").eq("resident_id", result.data.resident_id).is("deleted_at", null); if (medicationResult.error) {
        setError(medicationResult.error.message);
        return;
    } setMeds(medicationResult.data ?? []); }, [client, id]);
    useEffect(() => { void load(); }, [load]);
    async function record(action: "signature" | "implementation") { if (busy)
        return; setBusy(true); setError(null); try {
        const result = await client.rpc("record_verbal_order_review" as never, { p_id: id, p_action: action, p_evidence: evidence, p_signed_date: signedDate || null, p_medication_id: medicationId || null } as never);
        if (result.error)
            throw result.error;
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Order review was not saved");
    }
    finally {
        setBusy(false);
    } }
    return <main className="mx-auto max-w-2xl space-y-4"><Link href="/admin/medications/verbal-orders" className="underline">Back to verbal orders</Link><h1 className="text-2xl font-semibold">Verbal order review</h1>{error && <p role="alert">{error}</p>}{order && <><p>{order.order_text}</p><p>Prescriber: {order.prescriber_name} · Co-signature {order.cosignature_status} · {order.implemented ? "Implementation recorded" : "Implementation pending"}</p><Link href={`/admin/residents/${order.resident_id}/medications`} className="underline">Open medication orders to implement this instruction</Link><label className="block">Signed report reference / implementation evidence<textarea value={evidence} onChange={e => setEvidence(e.target.value)} className="block w-full rounded border p-3"/></label><label className="block">Physician signed date<input type="date" value={signedDate} onChange={e => setSignedDate(e.target.value)} className="m-2 rounded border p-2"/></label><Button disabled={busy || !evidence.trim() || !signedDate || order.cosignature_status === "signed"} onClick={() => void record("signature")}>Record receipt of physician signature</Button><label className="block">Resulting medication order<select value={medicationId} onChange={e => setMedicationId(e.target.value)} className="block rounded border p-2"><option value="">Select resulting order</option>{meds.map(m => <option key={m.id} value={m.id}>{m.medication_name} · {m.status}</option>)}</select></label><Button disabled={busy || !evidence.trim() || order.implemented} onClick={() => void record("implementation")}>Record completed implementation</Button><p>{order.implementation_notes}</p></>}</main>;
}
