"use client";

import type { CareEventPrintPacket } from "@/lib/care-events/print-data";
import {
  PRINT_BLANK,
  printDateTime,
  printValue,
  printYesNo,
} from "@/lib/care-events/print";
import { attachmentKindLabel } from "@/lib/care-events/attachments";
import {
  correctiveActionLabel,
  emsTreatmentLabel,
  familyMethodLabel,
  videoSecuredLabel,
} from "@/lib/care-events/admin-copy";
import { witnessChoiceLabel } from "@/lib/care-events/witness";
import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";

import { PrintSheet } from "./PrintSheet";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="shrink-0 font-semibold">{label}:</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="print-section mb-5">
      <h2 className="mb-2 border-b border-black pb-1 text-base font-bold uppercase tracking-wide">
        Section {number}. {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * COL's Incident Form, Sections 1 to 4 (spec 07A Appendix A), generated from
 * the care event, its incident, the administrator's completion answers, the
 * witness tasks and the attachment list. Nothing on this sheet is typed by
 * hand; a value Haven does not hold prints as a blank line, the way the paper
 * form left it blank.
 */
export function IncidentFormSheet({ packet }: { packet: CareEventPrintPacket }) {
  const { card, facility, resident, incidentExtras, witnesses, attachments } = packet;
  const tz = facility.timeZone;
  const admin = card.admin;
  const incident = card.incident;

  const residentName = resident ? [resident.lastName, resident.firstName].filter(Boolean).join(", ") : null;
  const chips = admin.correctiveActions;

  return (
    <PrintSheet title="Incident Report" facilityName={facility.name} timeZone={tz}>
      <div className="print-section mb-5 grid grid-cols-2 gap-x-8">
        <Field label="Incident number" value={printValue(incident?.incidentNumber)} />
        <Field label="Level" value={formatLevelWord(card.level)} />
        <Field label="Resident" value={printValue(residentName)} />
        <Field label="Room" value={printValue(resident?.roomLabel)} />
        <Field label="Date of birth" value={resident?.dateOfBirth ? printValue(resident.dateOfBirth) : PRINT_BLANK} />
        <Field label="Date and time of event" value={printDateTime(card.occurredAt, tz)} />
        <Field label="Discovered" value={printDateTime(card.createdAt, tz)} />
        <Field label="Reported by" value={printValue(card.reporter.fullName)} />
      </div>

      <Section number={1} title="What happened">
        <p className="mb-2 text-sm leading-relaxed">{card.sentence}</p>
        {card.note ? (
          <p className="mb-2 text-sm leading-relaxed">
            <span className="font-semibold">Staff note: </span>
            {card.note}
          </p>
        ) : null}
        <Field label="Injury" value={printYesNo(incidentExtras?.injuryOccurred ?? null)} />
        <Field label="Injury description" value={printValue(incidentExtras?.injuryDescription)} />
        <Field label="First aid or treatment given" value={printValue(emsTreatmentLabel(admin.ems ?? incident?.injuryTreatment))} />
        <Field label="Location" value={printValue(incidentExtras?.locationDescription)} />
      </Section>

      <Section number={2} title="Notifications">
        <Field
          label="Family notified"
          value={
            admin.familyNotifiedAt
              ? `${printDateTime(admin.familyNotifiedAt, tz)}${
                  familyMethodLabel(incident?.familyNotifiedMethod) ? ` · ${familyMethodLabel(incident?.familyNotifiedMethod)}` : ""
                }`
              : PRINT_BLANK
          }
        />
        <Field
          label="Physician notified"
          value={admin.physicianNotifiedAt ? printDateTime(admin.physicianNotifiedAt, tz) : PRINT_BLANK}
        />
        <Field label="Physician orders received" value={printValue(incident?.physicianOrders)} />
        <Field label="EMS or 911" value={printValue(emsTreatmentLabel(admin.ems))} />
        <Field
          label="Administrator acknowledged"
          value={card.acknowledgedAt ? printDateTime(card.acknowledgedAt, tz) : PRINT_BLANK}
        />
        <Field label="AHCA reportable" value={printYesNo(incident?.ahcaReportable ?? null)} />
        <Field
          label="DCF report made"
          value={admin.dcfReportedAt ? printDateTime(admin.dcfReportedAt, tz) : PRINT_BLANK}
        />
      </Section>

      <Section number={3} title="Witnesses">
        {witnesses.length === 0 ? (
          <p className="text-sm">No witness statements were requested.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 pr-3 font-semibold">Staff member</th>
                <th className="py-1 pr-3 font-semibold">Statement</th>
                <th className="py-1 pr-3 font-semibold">Given</th>
                <th className="py-1 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {witnesses.map((task) => (
                <tr key={task.id} className="border-b border-neutral-300 align-top">
                  <td className="py-1 pr-3">{printValue(task.assignedToName)}</td>
                  <td className="py-1 pr-3">{task.completedAt ? witnessChoiceLabel(task.choice) : "Not answered"}</td>
                  <td className="py-1 pr-3">{task.completedAt ? printDateTime(task.completedAt, tz) : PRINT_BLANK}</td>
                  <td className="py-1">{task.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section number={4} title="Corrective action">
        <Field
          label="Actions taken"
          value={chips.length > 0 ? chips.map(correctiveActionLabel).join("; ") : PRINT_BLANK}
        />
        <Field label="Other" value={printValue(admin.correctiveOther)} />
        <Field
          label="Contributing factors"
          value={
            incidentExtras?.contributingFactors && incidentExtras.contributingFactors.length > 0
              ? incidentExtras.contributingFactors.join("; ")
              : PRINT_BLANK
          }
        />
        <Field label="Video secured" value={printValue(videoSecuredLabel(admin.videoSecured))} />
        <Field label="Closed" value={card.closedAt ? printDateTime(card.closedAt, tz) : PRINT_BLANK} />
      </Section>

      <section className="print-section mb-5">
        <h2 className="mb-2 border-b border-black pb-1 text-base font-bold uppercase tracking-wide">Attachments</h2>
        {attachments.length === 0 ? (
          <p className="text-sm">No files are attached.</p>
        ) : (
          <ul className="text-sm">
            {attachments.map((file) => (
              <li key={file.id} className="py-0.5">
                {attachmentKindLabel(file.kind)} · added by {printValue(file.takenByName)} ·{" "}
                {printDateTime(file.takenAt, tz)}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-700">
          Files stay in Haven. This page lists what is on the record; it does not reproduce them.
        </p>
      </section>

      <section className="print-section grid grid-cols-2 gap-8 pt-4 text-sm">
        <div>
          <p className="border-b border-black pb-6" />
          <p className="pt-1">Administrator signature and date</p>
        </div>
        <div>
          <p className="border-b border-black pb-6" />
          <p className="pt-1">Reviewed by and date</p>
        </div>
      </section>
    </PrintSheet>
  );
}
