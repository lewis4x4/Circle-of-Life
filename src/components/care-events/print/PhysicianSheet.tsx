"use client";

import type { CareEventPrintPacket } from "@/lib/care-events/print-data";
import { PRINT_BLANK, printCode, printDateTime, printValue } from "@/lib/care-events/print";
import { emsTreatmentLabel } from "@/lib/care-events/admin-copy";
import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";

import { PrintSheet } from "./PrintSheet";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-48 shrink-0 font-semibold">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

/**
 * The physician notification sheet (COL-354). This replaces the fax, it is not
 * a fax integration: the administrator prints it, faxes it, and records
 * `physician_notified` with method `fax` on the completion form.
 *
 * The physician's fax number comes from `residents.primary_physician_fax`.
 * When Haven does not hold one, the line prints blank rather than guessing,
 * which is exactly what the paper form did.
 */
export function PhysicianSheet({ packet }: { packet: CareEventPrintPacket }) {
  const { card, facility, resident, incidentExtras } = packet;
  const tz = facility.timeZone;
  const residentName = resident ? [resident.lastName, resident.firstName].filter(Boolean).join(", ") : null;
  const facilityAddress = [facility.addressLine1, facility.city, facility.state, facility.zip]
    .filter((part) => Boolean(part && part.trim()))
    .join(", ");

  return (
    <PrintSheet title="Physician Notification" facilityName={facility.name} timeZone={tz}>
      <section className="print-section mb-5 text-sm">
        {facilityAddress ? <p>{facilityAddress}</p> : null}
        {facility.phone ? <p>Telephone {facility.phone}</p> : null}
        <p className="mt-2">Date and time sent: {printDateTime(new Date().toISOString(), tz)}</p>
      </section>

      <section className="print-section mb-5 border border-black p-3">
        <h2 className="mb-2 text-base font-bold uppercase tracking-wide">To the physician</h2>
        <Line label="Physician" value={printValue(resident?.physicianName)} />
        <Line label="Fax" value={printValue(resident?.physicianFax)} />
        <Line label="Telephone" value={printValue(resident?.physicianPhone)} />
      </section>

      <section className="print-section mb-5">
        <h2 className="mb-2 border-b border-black pb-1 text-base font-bold uppercase tracking-wide">Resident</h2>
        <Line label="Name" value={printValue(residentName)} />
        <Line label="Date of birth" value={resident?.dateOfBirth ? printValue(resident.dateOfBirth) : PRINT_BLANK} />
        <Line label="Room" value={printValue(resident?.roomLabel)} />
      </section>

      <section className="print-section mb-5">
        <h2 className="mb-2 border-b border-black pb-1 text-base font-bold uppercase tracking-wide">What happened</h2>
        <p className="mb-2 text-sm leading-relaxed">{card.sentence}</p>
        {card.note ? (
          <p className="mb-2 text-sm leading-relaxed">
            <span className="font-semibold">Staff note: </span>
            {card.note}
          </p>
        ) : null}
        <Line label="When" value={printDateTime(card.occurredAt, tz)} />
        <Line label="Level" value={formatLevelWord(card.level)} />
        <Line label="Injury" value={printValue(incidentExtras?.injuryDescription)} />
        <Line label="Body location" value={printCode(incidentExtras?.injuryBodyLocation)} />
        <Line label="First aid and treatment" value={printValue(incidentExtras?.immediateActions)} />
        <Line label="Sent to hospital or seen by EMS" value={printValue(emsTreatmentLabel(card.admin.ems))} />
        <Line label="Vitals taken" value={PRINT_BLANK} />
      </section>

      <section className="print-section mb-6">
        <h2 className="mb-2 border-b border-black pb-1 text-base font-bold uppercase tracking-wide">From the facility</h2>
        <Line label="Administrator" value={PRINT_BLANK} />
        <Line label="Callback number" value={printValue(facility.phone)} />
      </section>

      <section className="print-section border-2 border-black p-3">
        <h2 className="mb-3 text-base font-bold uppercase tracking-wide">Physician orders or signature</h2>
        <div className="space-y-6 text-sm">
          <p className="border-b border-black pb-6" />
          <p className="border-b border-black pb-6" />
          <p className="border-b border-black pb-6" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="border-b border-black pb-6" />
            <p className="pt-1">Physician signature</p>
          </div>
          <div>
            <p className="border-b border-black pb-6" />
            <p className="pt-1">Date</p>
          </div>
        </div>
      </section>

      <p data-print-hide className="mt-4 text-xs text-neutral-700">
        Print this, fax it, then record the physician notification on the completion form with method &ldquo;fax&rdquo;.
      </p>
    </PrintSheet>
  );
}
