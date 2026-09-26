"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdminEmptyState, AdminErrorState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { PageHeader } from "@/design-system/components/PageHeader";
import { DEFAULT_ACCURACY_WINDOW, type AccuracyReport, type AccuracyWindow } from "@/lib/document-intake/jev-accuracy-report";

import { intakeClient, IntakeReadError } from "../data";
import { loadAccuracyReport } from "./load";
import { MissesList } from "./MissesList";
import { TypeDetailPanel } from "./TypeDetailPanel";
import { TypeTable } from "./TypeTable";
import { WindowControl } from "./WindowControl";

export type AccuracyViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; forbidden: boolean }
  | { status: "success-empty" }
  | { status: "success-populated"; report: AccuracyReport };

const DETAIL_ID = "jev-type-detail";

function accuracyHref(span: AccuracyWindow, type: string | null): string {
  const params = new URLSearchParams();
  if (span !== DEFAULT_ACCURACY_WINDOW) params.set("window", span);
  if (type) params.set("type", type);
  const query = params.toString();
  return query ? `/admin/document-intake/accuracy?${query}` : "/admin/document-intake/accuracy";
}

/** Jev accuracy (COL-771, DI-10): per type, whether to trust Jev's pre-selection more, less, or not at all. */
export function JevAccuracyView({ initialWindow, initialType }: { initialWindow: AccuracyWindow; initialType: string | null }) {
  const router = useRouter();
  const [span, setSpan] = useState<AccuracyWindow>(initialWindow);
  const [selected, setSelected] = useState<string | null>(initialType);
  const [state, setState] = useState<AccuracyViewState>({ status: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setState({ status: "loading" });
    try {
      const report = await loadAccuracyReport(intakeClient(), span, Date.now());
      if (current !== sequence.current) return;
      setState(report.types.length === 0 && report.misses.length === 0 ? { status: "success-empty" } : { status: "success-populated", report });
    } catch (cause) {
      if (current !== sequence.current) return;
      const forbidden = cause instanceof IntakeReadError && cause.forbidden;
      setState({ status: "error", message: cause instanceof IntakeReadError ? cause.message : "Jev accuracy could not be loaded. Try again in a moment.", forbidden });
    }
  }, [span]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  function changeWindow(next: AccuracyWindow) {
    setSpan(next);
    router.replace(accuracyHref(next, selected), { scroll: false });
  }

  function selectType(code: string | null) {
    setSelected(code);
    router.replace(accuracyHref(span, code), { scroll: false });
  }

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-8 pt-2">
      <PageHeader
        title="Jev accuracy"
        subtitle="How often Jev's pick matched what a person filed, per document type, and what to change. Every filing still needs a person."
        backLink={{ label: "Document Intake", href: "/admin/document-intake" }}
        actions={<WindowControl value={span} onChange={changeWindow} disabled={state.status === "loading"} />}
      />

      {state.status === "error" ? (
        state.forbidden ? (
          <AdminEmptyState title="You can't see Jev accuracy" description="Your role does not include Document Intake review. Ask an administrator if you need it." />
        ) : (
          <AdminErrorState title="Jev accuracy did not load" message={state.message} onRetry={() => setReloadKey((k) => k + 1)} />
        )
      ) : state.status === "idle" || state.status === "loading" ? (
        <div aria-busy="true" aria-label="Loading Jev accuracy">
          <AdminTableLoadingState />
        </div>
      ) : state.status === "success-empty" ? (
        <AdminEmptyState
          title="No filed documents with Jev activity in this window yet"
          description="Numbers appear here once people file documents that Jev looked at. Pick a longer window, or check back after the next filings."
        />
      ) : (
        <ReportBody report={state.report} selected={selected} onSelect={selectType} />
      )}
    </div>
  );
}

function ReportBody({ report, selected, onSelect }: { report: AccuracyReport; selected: string | null; onSelect: (code: string | null) => void }) {
  const { agree, total } = report.readerAgreement;
  const summary = selected ? report.types.find((t) => t.code === selected) : undefined;
  const detail = selected ? report.details[selected] : undefined;
  const anyLastRun = report.types.some((t) => t.marginNow.source === "last_run");
  return (
    <>
      <p className="text-sm text-foreground">
        Reader type agreement:{" "}
        <span className="tabular-nums font-medium">
          {agree} of {total}
        </span>{" "}
        <span className="text-muted-foreground">filed documents were filed as the type the reader proposed.</span>
      </p>

      {report.types.length > 0 ? (
        <>
          <TypeTable types={report.types} selected={summary ? selected : null} detailId={DETAIL_ID} onSelect={onSelect} />
          {anyLastRun ? (
            <p className="text-xs text-muted-foreground">
              &quot;At last run&quot; means your role cannot read the live setting, so the margin shown is the one the most recent Jev run used.
            </p>
          ) : null}
          {summary && detail ? (
            <TypeDetailPanel id={DETAIL_ID} summary={summary} detail={detail} />
          ) : (
            <p className="text-xs text-muted-foreground">Choose a type to see its margins, its checks, and any setting change.</p>
          )}
        </>
      ) : null}

      <MissesList misses={report.misses} />
    </>
  );
}
