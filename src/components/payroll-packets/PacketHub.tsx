"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FacilityGate, useFacilityGateScope } from "@/components/common/FacilityGate";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PacketHub as Hub, PayrollPacket } from "@/lib/payroll-packets/types";
import PolicyForm from "./PolicyForm";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { fieldClass, hours, panelClass, request, statusLabel, useDraftGuard } from "./shared";

export default function PacketHub() {
  const { facilityId } = useFacilityGateScope();
  return <FacilityGate title="Payroll" reason="Payroll packets belong to one facility and pay period.">{facilityId && <FacilityPackets key={facilityId} facilityId={facilityId} />}</FacilityGate>;
}
function FacilityPackets({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Hub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [dates, setDates] = useState({ periodStart: "", periodEnd: "", checkDate: "" });
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  useDraftGuard(creating && Object.values(dates).some(Boolean), busy);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(null);
    request<Hub>(`/api/admin/payroll-packets?facility_id=${encodeURIComponent(facilityId)}`, { signal: controller.signal }).then(setData).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load payroll packets."); });
    return () => controller.abort();
  }, [facilityId, refresh]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await request<{ packet: PayrollPacket }>("/api/admin/payroll-packets", { method: "POST", body: JSON.stringify({ facilityId, ...dates }) });
      setDates({ periodStart: "", periodEnd: "", checkDate: "" }); setCreating(false); setBusy(false);
      router.push(`/admin/payroll/packets/${result.packet.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare packet."); setBusy(false); }
  }
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Payroll</h1><p className="mt-2 text-sm text-muted-foreground">One approved packet for phone calls and RUN entry.</p></div><div className="flex flex-wrap gap-2"><Link href="/admin/payroll/legacy" className={buttonVariants({ variant: "outline" })}>Legacy batches</Link>{data?.canConfigure && <Button variant="outline" aria-expanded={showSettings} onClick={() => setShowSettings(true)}>Payroll rules</Button>}<Button disabled={!data || busy} onClick={() => setCreating(true)}>Prepare payroll packet</Button></div></header>
    {error && <div role="alert" className={`${panelClass} text-destructive`}>{error} {!data && <Button className="ml-3" variant="outline" onClick={() => setRefresh((n) => n + 1)}>Retry</Button>}</div>}
    {!data && !error && <p role="status">Loading payroll packets…</p>}
    {data && <>
      <section className={panelClass}><p className="font-medium">{data.policy?.confirmed_at ? "Payroll rules confirmed" : "Payroll rules need confirmation"}</p><p className="mt-1 text-sm text-muted-foreground">{data.policy?.confirmed_at ? "Prepare, review, approve, report, then reconcile each packet against ADP." : "You can prepare a draft now. Approval is blocked until the employer, hours rules and approver are confirmed."}</p><p className="mt-2 text-sm">Downloading a packet does not submit payroll or mark it reported.</p></section>
      {showSettings && data.canConfigure && <PolicyForm key={`${facilityId}-${data.policy?.revision ?? "unconfigured"}`} facilityId={facilityId} policy={data.policy} facilities={data.facilities} onSaved={() => setRefresh((n) => n + 1)} />}
      {creating && <form className={panelClass} onSubmit={(e) => void create(e)}><h2 className="text-lg font-semibold">Prepare a new packet</h2><fieldset disabled={busy} className="mt-4 grid gap-4 sm:grid-cols-3">{([["periodStart", "Period starts"], ["periodEnd", "Period ends (inclusive)"], ["checkDate", "Check date"]] as const).map(([key, label]) => <label className="space-y-1 text-sm" key={key}><span>{label}</span><input required className={fieldClass} type="date" min={key === "periodEnd" ? dates.periodStart : key === "checkDate" ? dates.periodEnd : undefined} value={dates[key]} onChange={(e) => setDates((old) => ({ ...old, [key]: e.target.value }))} /></label>)}</fieldset><p className="my-4 text-sm text-muted-foreground">Review the dates against your payroll calendar. Timecard data and payroll rules will be checked before approval.</p><Button type="submit" disabled={busy}>{busy ? "Preparing…" : "Create draft"}</Button></form>}
      {data.packets.length === 0 ? <section className={panelClass}><h2 className="font-semibold">No payroll packets yet</h2><p className="mt-2 text-sm text-muted-foreground">Prepare the first packet for this facility using the pay-period dates and check date.</p></section> : <HorizontalScroll label="Payroll packets" className="rounded-[var(--radius)] border border-border bg-card"><table className="w-full min-w-[40rem] text-left text-sm"><thead><tr className="border-b"><th className="p-4">Pay period</th><th className="p-4">Check date</th><th className="p-4">Version</th><th className="p-4">Status</th><th className="p-4">Paid hours</th></tr></thead><tbody>{data.packets.map((packet) => <tr key={packet.id} className="border-b last:border-0"><td className="p-4"><Link className="font-medium text-primary underline" href={`/admin/payroll/packets/${packet.id}`}>{packet.period_start} – {packet.period_end}</Link></td><td className="p-4">{packet.check_date}</td><td className="p-4">{packet.version}</td><td className="p-4">{statusLabel(packet.status)}</td><td className="p-4">{hours(packet.snapshot.totals.paidMinutes)}</td></tr>)}</tbody></table></HorizontalScroll>}
    </>}
  </div>;
}
