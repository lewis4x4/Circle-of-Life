import { enumLabel } from '@/lib/display/enum-label';
import {
  admissionLine, personLabel, recruiterItemLine, reportDay, reportStamp, stayLabel, timelineKindLabel, timelineLine, tourLine,
  type FacilityReport, type PotentialResident, type ReportPerson,
} from '@/lib/stand-up/thursday-report';

/**
 * COL-754: everything under one facility on Thursday after its figures: who
 * left and who is away, the potential residents with every note and contact in
 * time order, and each recruiter's activity since Monday's call. Plain markup,
 * so the same component reads on screen and on paper.
 */
export function ThursdayReportSections({ report, headingLevel = 3 }: { report: FacilityReport; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const since = reportStamp(report.since);
  return <div className="space-y-6">
    <section aria-label={`${report.facility_name}: who left and who is away`} className="space-y-2 break-inside-avoid">
      <H className="font-semibold">Departures and hospital or rehab stays since Monday</H>
      <p className="text-xs text-muted-foreground">Since Monday’s call, {since}.{report.names_shown ? '' : ' Names are shown to administrators; you see how many.'}</p>
      <PeopleList title="Departures" empty="No discharge or death since Monday." people={report.departures}
        line={person => `${personLabel(person, 'A resident')} · ${enumLabel(person.kind ?? '')} · ${reportDay(person.at)}`} />
      <PeopleList title="At hospital or rehab now" empty="Nobody is at a hospital or in rehab." people={report.hospital.out_now}
        line={person => `${personLabel(person, 'A resident')} · ${stayLabel(person.stay_type)} · since ${reportDay(person.since)}`} />
      <PeopleList title="Went out since Monday" empty="Nobody went out since Monday." people={report.hospital.went_out}
        line={person => `${personLabel(person, 'A resident')} · ${stayLabel(person.stay_type)} · ${reportDay(person.at)}${person.back_at ? `, back ${reportDay(person.back_at)}` : ''}`} />
      <PeopleList title="Came back since Monday" empty="Nobody came back since Monday." people={report.hospital.came_back}
        line={person => `${personLabel(person, 'A resident')} · back ${reportDay(person.back_at)}`} />
    </section>

    <section aria-label={`${report.facility_name}: potential residents`} className="space-y-3">
      <H className="font-semibold">Potential residents ({report.potential_residents.length})</H>
      {!report.potential_residents.length && <p className="text-sm">No open referral for this facility.</p>}
      {!report.admission_notes_shown && report.potential_residents.length > 0 && <p className="text-xs text-muted-foreground">{report.admission_workflow_shown
        ? 'Admission steps, quoted-rate notes and paperwork notes are shown. The admission’s own notes and clinical notes are shown to administrators.'
        : 'Admission notes are shown to administrators.'}</p>}
      {report.potential_residents.map(lead => <PotentialResidentCard key={lead.lead_id} lead={lead} />)}
    </section>

    <section aria-label={`${report.facility_name}: recruiters since Monday`} className="space-y-3 break-inside-avoid">
      <H className="font-semibold">Recruiters since Monday</H>
      {!report.recruiters.length && <p className="text-sm">No recruiter works this facility in Haven.</p>}
      {report.recruiters.map(recruiter => <div key={recruiter.user_id} className="space-y-1 rounded border border-border p-3">
        <p className="font-medium">{recruiter.name} · {plural(recruiter.contacts, 'contact')} · {plural(recruiter.tours, 'tour')} · {plural(recruiter.outreach, 'outreach activity', 'outreach activities')}</p>
        {recruiter.items.length ? <ul className="space-y-1 text-sm">{recruiter.items.map((item, index) => <li key={index}><span className="text-muted-foreground">{reportStamp(item.at)}</span> · {recruiterItemLine(item)}</li>)}</ul>
          : <p className="text-sm text-muted-foreground">Nothing logged at this facility since Monday.</p>}
      </div>)}
    </section>
  </div>;
}

function plural(count: number, one: string, many = `${one}s`) { return `${count} ${count === 1 ? one : many}`; }

function PeopleList({ title, empty, people, line }: { title: string; empty: string; people: ReportPerson[]; line: (person: ReportPerson) => string }) {
  return <div className="text-sm">
    <p className="font-medium">{title} ({people.length})</p>
    {people.length ? <ul className="list-disc pl-5">{people.map((person, index) => <li key={index}>{line(person)}</li>)}</ul> : <p className="text-muted-foreground">{empty}</p>}
  </div>;
}

function PotentialResidentCard({ lead }: { lead: PotentialResident }) {
  return <article aria-label={lead.name} className="space-y-2 rounded border border-border p-3 break-inside-avoid">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-medium">{lead.name}{lead.new ? <span className="ml-2 rounded border border-border px-1.5 text-xs">New since Monday</span> : null}</p>
      <p className="text-sm text-muted-foreground">{enumLabel(lead.stage)} · {lead.owner_name ? `Owner: ${lead.owner_name}` : 'No owner'}</p>
    </div>
    <p className="text-sm">{lead.next_action ? `Next: ${lead.next_action}${lead.next_action_at ? ` · ${reportStamp(lead.next_action_at)}` : ''}` : 'No next step set'}</p>
    <div className="text-sm">
      <p className="font-medium">Tours</p>
      {lead.tours.length ? <ul className="list-disc pl-5">{lead.tours.map((tour, index) => <li key={index}>{tourLine(tour)}{tour.new ? ' · new' : ''}</li>)}</ul> : <p className="text-muted-foreground">No tour recorded.</p>}
    </div>
    <div className="text-sm">
      <p className="font-medium">Admission</p>
      {lead.admission ? <p>{admissionLine(lead.admission).join(' · ')}</p> : <p className="text-muted-foreground">No admission case yet.</p>}
    </div>
    <div className="text-sm">
      <p className="font-medium">Notes and contacts</p>
      {lead.notes_withheld && <p className="text-muted-foreground">Notes on this referral are not shown to your role.</p>}
      {lead.timeline.length ? <ol className="space-y-1">{lead.timeline.map((item, index) => <li key={index} className={item.new ? 'border-l-2 border-foreground pl-2' : 'pl-2.5'}>
        <span className="text-muted-foreground">{reportStamp(item.at)} · {timelineKindLabel(item.kind)}{item.by ? ` · ${item.by}` : ''}{item.new ? ' · New since Monday' : ''}</span>
        <span className="block">{timelineLine(item)}</span>
      </li>)}</ol> : <p className="text-muted-foreground">Nothing logged yet.</p>}
    </div>
  </article>;
}
