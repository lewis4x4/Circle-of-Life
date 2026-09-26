"use client";

import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMargin, formatShare, type TypeDetail, type TypeSummary } from "@/lib/document-intake/jev-accuracy-report";

import { CHECK_ACTION_LABELS, checkTone, recommendationLabel, recommendationNote } from "./labels";
import { SettingChange } from "./SettingChange";

const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

/** Tier 2 for one type: what each margin would have done, how each check holds up, and the setting change. */
export function TypeDetailPanel({ id, summary, detail }: { id: string; summary: TypeSummary; detail: TypeDetail }) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-1">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {summary.label}
        </h2>
        <p className="text-xs text-muted-foreground">
          Question set {summary.questionsVersion ? <code className="font-mono">{summary.questionsVersion}</code> : "not recorded"}
          {summary.excludedOlder > 0 ? `. ${summary.excludedOlder} ${summary.excludedOlder === 1 ? "document" : "documents"} on older questions left out.` : "."}
        </p>
        <p className="text-xs text-muted-foreground">
          Recommendation: {recommendationLabel(summary.recommendation)}. {sentence(recommendationNote(summary.recommendation))}
        </p>
      </div>

      <div className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Margin</h3>
        <p className="text-xs text-muted-foreground">
          Jev pre-selects a destination only when its top pick leads the runner-up by more than the margin. A higher margin means fewer pre-selections.
        </p>
        <Table aria-label={`Margins for ${summary.label}`}>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">Would clear</TableHead>
              <TableHead className="text-right">Right</TableHead>
              <TableHead className="text-right">Accuracy</TableHead>
              <TableHead className="text-right">Lower bound</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.margins.map((m) => (
              <TableRow key={m.margin} data-state={m.current ? "selected" : undefined}>
                <TableCell className="text-right tabular-nums">
                  {formatMargin(m.margin)}
                  {m.current ? <span className="ml-1 text-xs font-medium text-foreground">(now)</span> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.cleared}</TableCell>
                <TableCell className="text-right tabular-nums">{m.right}</TableCell>
                <TableCell className="text-right tabular-nums">{m.cleared ? formatShare(m.accuracy) : "None"}</TableCell>
                <TableCell className="text-right tabular-nums">{m.cleared ? formatShare(m.lowerBound) : "None"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Checks on this question set</h3>
        {detail.checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Jev has not answered a check on this question set in the window.</p>
        ) : (
          <Table aria-label={`Jev checks for ${summary.label}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead className="text-right">Answered</TableHead>
                <TableHead className="text-right">Rated</TableHead>
                <TableHead className="text-right">Reviewers agreed</TableHead>
                <TableHead className="text-right">Unsure</TableHead>
                <TableHead>Recommendation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.checks.map((c) => (
                <TableRow key={c.code}>
                  <TableCell className="max-w-72">
                    <span className="block text-foreground">{c.label}</span>
                    <code className="block font-mono text-xs text-muted-foreground">{c.code}</code>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.answered}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.rated}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.right_rate == null ? "None rated" : formatShare(c.right_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatShare(c.unknown_share)}</TableCell>
                  <TableCell className="min-w-56">
                    <StatusPill tone={checkTone(c.action)}>{CHECK_ACTION_LABELS[c.action]}</StatusPill>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{c.reason}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {detail.sql ? (
        <SettingChange key={summary.code} sql={detail.sql} />
      ) : (
        <p className="text-sm text-muted-foreground">No setting change is recommended for this type.</p>
      )}
    </section>
  );
}
