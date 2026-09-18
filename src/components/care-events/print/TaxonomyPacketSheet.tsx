"use client";

import {
  TAXONOMY_SIGN_OFF_ROWS,
  buildTaxonomyPacket,
  channelWords,
  offsetWords,
  type LevelEffectRow,
} from "@/lib/care-events/taxonomy-packet";
import type { PrintFacility } from "@/lib/care-events/print-data";

import { PrintSheet } from "./PrintSheet";

export type TaxonomyPacketSheetProps = {
  facility: PrintFacility;
  effects: LevelEffectRow[];
};

/**
 * The taxonomy review packet (COL-354). Generated from `CARE_EVENT_TILES`,
 * `level-cases.json` and the facility's own configuration rows — never from a
 * hand-written list, so a signature on the last page is a signature on what the
 * system does.
 */
export function TaxonomyPacketSheet({ facility, effects }: TaxonomyPacketSheetProps) {
  const sections = buildTaxonomyPacket();
  const caseCount = sections.reduce((total, section) => total + section.cases.length, 0);

  return (
    <PrintSheet title="Care Events: taxonomy review" facilityName={facility.name} timeZone={facility.timeZone}>
      <section className="print-section mb-6 text-sm">
        <p className="mb-2">
          This packet is generated from the running system: the eight tiles and their questions, every level case the
          TypeScript and SQL engines are held equal against, and the escalation and follow-up rows this facility is
          configured with. It is not a summary written by hand.
        </p>
        <p>
          {sections.length} tiles · {caseCount} level cases · review each tile, then sign the last page.
        </p>
      </section>

      <section className="print-section mb-6">
        <h2 className="mb-2 border-b-2 border-black pb-1 text-lg font-bold">What fires at each level</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th scope="col" className="py-1 pr-2 font-semibold">Level</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Must acknowledge</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Who is told, and when</th>
              <th scope="col" className="py-1 font-semibold">Follow-up tasks created</th>
            </tr>
          </thead>
          <tbody>
            {effects.map((row) => (
              <tr key={row.level} className="border-b border-neutral-400 align-top">
                <td className="py-1 pr-2 font-semibold">{row.word}</td>
                <td className="py-1 pr-2">
                  {row.ackWithinMinutes === null ? "Not required" : `Within ${row.ackWithinMinutes} minutes`}
                </td>
                <td className="py-1 pr-2">
                  {row.steps.length === 0 ? (
                    "Nobody is interrupted."
                  ) : (
                    <ul>
                      {row.steps.map((step) => (
                        <li key={step.step}>
                          {step.target} by {channelWords(step.channels)} {offsetWords(step.afterMinutes)}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-1">
                  {row.followups.length === 0 ? (
                    "None"
                  ) : (
                    <ul>
                      {row.followups.map((task) => (
                        <li key={`${task.kind}-${task.taskType}-${task.dueOffsetMinutes}`}>
                          {task.description} {offsetWords(task.dueOffsetMinutes)}
                          {task.kind === "any" ? "" : ` (${task.kind.replace(/_/g, " ")})`}
                          {task.requiresFlag ? ` when ${task.requiresFlag.replace(/_/g, " ")}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {sections.map((section) => (
        <section key={section.tile.kind} className="print-page-break print-section mb-6">
          <h2 className="mb-1 border-b-2 border-black pb-1 text-lg font-bold">{section.tile.word}</h2>
          <p className="mb-2 text-sm">{section.tile.description}</p>
          <p className="mb-3 text-xs">
            <span className="font-semibold">Replaces on paper: </span>
            {section.paperReplaced}
          </p>

          <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">Questions asked</h3>
          <ul className="mb-3 text-xs">
            {section.questions.map((question) => (
              <li key={question.key} className="py-0.5">
                <span className="font-semibold">{question.prompt}</span>
                {question.multi ? " (choose any)" : ""} — {question.options.map((option) => option.label).join(" / ")}
              </li>
            ))}
          </ul>

          <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">Every answer and what it produces</h3>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black text-left">
                <th scope="col" className="py-1 pr-2 font-semibold">Answers</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Level</th>
                <th scope="col" className="py-1 pr-2 font-semibold">Category</th>
                <th scope="col" className="py-1 font-semibold">Also raises</th>
              </tr>
            </thead>
            <tbody>
              {section.cases.map((row) => (
                <tr key={row.id} className="border-b border-neutral-300 align-top">
                  <td className="py-1 pr-2">
                    {row.answers.map((answer) => (
                      <span key={answer.prompt} className="block">
                        {answer.prompt}: {answer.answer}
                      </span>
                    ))}
                  </td>
                  <td className="py-1 pr-2 font-semibold">
                    {row.levelWord}
                    {row.bumped ? " (reporter raised it)" : ""}
                  </td>
                  <td className="py-1 pr-2">{row.categoryLabel}</td>
                  <td className="py-1">{row.flagsRaised.length > 0 ? row.flagsRaised.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="print-page-break print-section">
        <h2 className="mb-2 border-b-2 border-black pb-1 text-lg font-bold">Sign off</h2>
        <p className="mb-4 text-sm">
          Paper and fax retirement does not begin until the second row below is signed.
        </p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black text-left">
              <th scope="col" className="w-1/3 py-2 pr-3 font-semibold">What is being signed</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Name</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Signature</th>
              <th scope="col" className="py-2 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            {TAXONOMY_SIGN_OFF_ROWS.map((row) => (
              <tr key={row.subject} className="border-b border-black align-bottom">
                <td className="py-6 pr-3">
                  <span className="block font-semibold">{row.subject}</span>
                  <span className="mt-1 block text-xs font-normal">{row.detail}</span>
                </td>
                <td className="py-6 pr-3" />
                <td className="py-6 pr-3" />
                <td className="py-6" />
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs">
          A change to the taxonomy goes back as an issue against spec 07A. It is never an ad hoc edit to a running rule.
        </p>
      </section>
    </PrintSheet>
  );
}
