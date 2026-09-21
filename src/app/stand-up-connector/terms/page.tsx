import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Stand Up Connector Terms of Use',
  description: 'Operating terms for the COL Haven Stand Up Connector.',
};

export default function StandUpConnectorTermsPage() {
  return (
    <article className="space-y-8 leading-7 text-[#3f4b45]">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#516f60]">Effective September 21, 2026</p>
        <h1 className="font-serif text-4xl font-semibold text-[#1c2822]">Stand Up Connector Terms of Use</h1>
      </header>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Authorized use</h2><p>The connector is for authorized Circle of Life operating personnel and the dedicated company account approved to synchronize the selected Stand Up workbook. It may not be used to access unrelated files or for any personal purpose.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Human review</h2><p>The connector validates workbook structure and preserves version evidence. When Haven and the workbook contain competing edits, it never chooses a winner automatically. An authorized administrator must review the differences before figures are replaced.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Operational limitations</h2><p>Stand Up figures are operating reports and are not independently verified merely because they synchronized. The connector does not replace clinical judgment, licensure responsibilities, payroll reconciliation, or management approval.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Availability and access</h2><p>Synchronization may stop when Google access is revoked, the selected workbook changes incompatibly, or a safety check requires review. Circle of Life may suspend or replace connector access to protect its systems and records.</p></section>
      <section className="space-y-3"><h2 className="font-serif text-2xl font-semibold text-[#1c2822]">Contact</h2><p>Questions about these terms can be sent through the <a className="underline" href="https://circleoflifecommunities.com/contact-us/">Circle of Life contact page</a>.</p></section>
    </article>
  );
}
