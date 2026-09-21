import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Stand Up Connector Privacy Policy',
  description: 'How the COL Haven Stand Up Connector accesses and protects Google Drive data.',
};

export default function StandUpConnectorPrivacyPage() {
  return (
    <article className="space-y-8 leading-7 text-[#3f4b45]">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#516f60]">Effective September 21, 2026</p>
        <h1 className="font-serif text-4xl font-semibold text-[#1c2822]">Stand Up Connector Privacy Policy</h1>
        <p>This policy covers Google user data used by the COL Haven Stand Up Connector.</p>
      </header>

      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Data the connector accesses</h2><p>The connector requests Google&apos;s <code>drive.file</code> scope. That permission is limited to files an authorized user selects for this application. The connector reads file metadata and the contents of the selected Stand Up workbook and can update only its mapped Stand Up cells.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">How the data is used</h2><p>Workbook figures are used only to synchronize Circle of Life&apos;s weekly operating report with Haven, detect conflicting edits, preserve source provenance, and recover reviewed changes. Google user data is not sold, used for advertising, or used to train artificial-intelligence models.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Storage and sharing</h2><p>OAuth credentials are stored as restricted server secrets. Workbook bytes are processed transiently and are not stored as a general Drive archive. Haven retains audit-safe hashes, file version metadata, review decisions, and the operating figures needed for the Stand Up record. Only approved numeric summaries are published to Front Office; Google credentials and workbook contents are not shared with it.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Security and control</h2><p>Access is limited to the dedicated server connector and authorized Circle of Life administrators. Transfers use encrypted HTTPS connections. An authorized user can revoke access from their Google Account at any time; revocation stops synchronization until the company reconnects the selected workbook.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Google API policy</h2><p>The connector&apos;s use and transfer of information received from Google APIs adheres to the <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Questions</h2><p>Questions or revocation requests can be sent through the <a className="underline" href="https://circleoflifecommunities.com/contact-us/">Circle of Life contact page</a>.</p></section>
    </article>
  );
}
