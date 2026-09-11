import { derivedValues, reportState, metricDisplay, type StandUpReport } from '@/lib/stand-up/model';

const unknown = 'Not provided';
const dollars = (value: number | null) => value === null ? unknown : `$${(value / 100).toFixed(2)}`;
function difference(current: number | null, prior: number | null | undefined, currency = false) {
  if (current === null || prior === null || prior === undefined) return 'Change unavailable';
  const delta = current - prior;
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${currency ? dollars(Math.abs(delta)) : Math.abs(delta)}`;
}

export function StandUpHistory({ reports, facilityId, facilityName }: {
  reports: StandUpReport[]; facilityId: string; facilityName: string;
}) {
  const rows = reports.filter(report => report.facility_id === facilityId)
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
  return <section aria-label="Facility report history" className="space-y-3 rounded border p-4">
    <h2 className="text-lg font-semibold">{facilityName} — report history</h2>
    <p>Newest week first. Changes compare with the previous available report. Gaps are identified; missing figures are not zero. These are reported figures; payroll and operating-record verification is separate.</p>
    {rows.length === 0 ? <p>No saved reports for this facility yet.</p> : <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable facility history table">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Weekly facility figures and changes from the previous available report</caption>
        <thead><tr>{['Monday / comparison', 'Monthly rent roll / change', 'Census / change', 'Calculated average rent', 'Prior-week callouts', 'Prior-week overtime', 'Status', 'Figures observed (Eastern)'].map(label => <th className="p-2 align-top" scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((report, index) => {
          const prior = rows[index + 1];
          const days = prior ? (Date.parse(`${report.week_start}T12:00:00Z`) - Date.parse(`${prior.week_start}T12:00:00Z`)) / 86400000 : null;
          const derived = derivedValues(report.values);
          return <tr key={report.id} className="border-t">
            <th scope="row" className="p-2 align-top font-normal">{report.week_start}<span className="block text-xs">{prior ? `Compared with ${prior.week_start}${days !== 7 ? ' — gap in weekly reports' : ''}` : 'No earlier report'}</span></th>
            <td className="p-2 align-top">{dollars(report.values.monthly_rent_roll_cents)}<span className="block text-xs">{difference(report.values.monthly_rent_roll_cents, prior?.values.monthly_rent_roll_cents, true)}</span></td>
            <td className="p-2 align-top">{report.values.current_total_census ?? unknown}<span className="block text-xs">{difference(report.values.current_total_census, prior?.values.current_total_census)}</span></td>
            <td className="p-2 align-top">{derived.average_rent_cents === null ? 'Not calculable' : dollars(derived.average_rent_cents)}</td>
            <td className="p-2 align-top">{report.values.callouts_last_week ?? unknown}</td>
            <td className="p-2 align-top">{metricDisplay('overtime_reported', report.values.overtime_reported)}</td>
            <td className="p-2 align-top">{reportState(report)}</td>
            <td className="p-2 align-top">{report.source_as_of ? new Date(report.source_as_of).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'Unknown'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </section>;
}
