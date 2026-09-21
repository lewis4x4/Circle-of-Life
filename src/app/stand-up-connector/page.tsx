import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'COL Haven Stand Up Connector',
  description: 'How Circle of Life securely connects its selected weekly Stand Up workbook with Haven.',
};

export default function StandUpConnectorPage() {
  return (
    <article className="space-y-10">
      <header className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#516f60]">Internal operating integration</p>
        <h1 className="font-serif text-4xl font-semibold sm:text-5xl">COL Haven Stand Up Connector</h1>
        <p className="max-w-3xl text-lg leading-8 text-[#3f4b45]">
          The connector keeps one administrator-selected weekly Stand Up workbook synchronized with Haven for Circle of Life&apos;s five assisted living facilities.
        </p>
      </header>

      <section className="grid gap-5 sm:grid-cols-2" aria-label="Connector responsibilities">
        <div className="rounded-2xl border border-[#d9d2c4] bg-white p-6">
          <h2 className="font-serif text-2xl font-semibold">What it accesses</h2>
          <p className="mt-3 leading-7 text-[#4e5b54]">Google grants per-file access to the weekly workbook selected by an administrator. The connector does not browse unrelated Drive files.</p>
        </div>
        <div className="rounded-2xl border border-[#d9d2c4] bg-white p-6">
          <h2 className="font-serif text-2xl font-semibold">What it does</h2>
          <p className="mt-3 leading-7 text-[#4e5b54]">It reads mapped operating figures, records their provenance, and writes reviewed Haven changes back only to the mapped cells in that workbook.</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold">Designed to stop on uncertainty</h2>
        <p className="leading-7 text-[#4e5b54]">If the workbook and Haven both change, the connector preserves both versions and requires an authorized administrator to review the differences. It does not silently overwrite either source.</p>
        <p className="leading-7 text-[#4e5b54]">Resident names, employee names, workbook contents, and Google credentials are not sent to Front Office. Front Office receives only the approved numeric Stand Up summary.</p>
      </section>

      <div className="flex flex-wrap gap-4 text-sm font-semibold">
        <a className="rounded-lg bg-[#315544] px-5 py-3 text-white" href="/stand-up-connector/privacy">Privacy policy</a>
        <a className="rounded-lg border border-[#315544] px-5 py-3 text-[#315544]" href="/stand-up-connector/terms">Terms of use</a>
      </div>
    </article>
  );
}
