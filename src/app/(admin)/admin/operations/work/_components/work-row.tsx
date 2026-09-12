"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useEffect, useRef, useState } from "react";
import { usePendingSave } from "@/hooks/use-pending-save";
import {
  isBusy,
  type DraftSummary,
  type SaveState,
} from "@/lib/operations/recovery-client";
import type {
  WorkspaceItem,
  WorkspaceReceipt,
} from "@/lib/operations/workspace";
import { SaveStateNotice } from "../../_components/save-state-notice";
import { EvidencePanel } from "./evidence-panel";
import { TaskHelpHandover } from "./task-help-handover";
import {
  ReceiptHistory,
  ReceiptSummary,
  localTime,
  readJson,
} from "./receipt-history";
import {
  CONTROL,
  DateTimeInput,
  WorkInputs,
  typedValues,
  displayValues,
  type Values,
} from "./work-inputs";

const noDraftListing = async () => ({
  kind: "ok" as const,
  body: { drafts: [] },
});
type Mode = "record" | "correct" | "reverse" | "issue";
export type WorkRowProps = {
  item: WorkspaceItem;
  facilityId: string;
  actorId: string;
  actorName: string | null;
  timezone: string;
  view: "today" | "upcoming" | "history";
  pendingDrafts: DraftSummary[];
  recordingUnavailable?: boolean;
};

export function WorkRow({
  item: initial,
  facilityId,
  actorId,
  actorName,
  timezone,
  view,
  pendingDrafts,
  recordingUnavailable = false,
}: WorkRowProps) {
  const [item, setItem] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(false);
  const [mode, setMode] = useState<Mode>("record");
  const [more, setMore] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [outcome, setOutcome] = useState("performed");
  const [entry, setEntry] = useState("routine");
  const [performedAt, setPerformedAt] = useState("");
  const [performerKind, setPerformerKind] = useState("self");
  const [performer, setPerformer] = useState("");
  const [reason, setReason] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [receiptUnavailable, setReceiptUnavailable] = useState(false);
  const [summary, setSummary] = useState("");
  const [issueKind, setIssueKind] = useState("problem");
  const [severity, setSeverity] = useState("normal");
  const [error, setError] = useState("");
  const [replayed, setReplayed] = useState(false);
  const [consumed, setConsumed] = useState<string[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const active = useRef(true);
  const primary = useRef<HTMLButtonElement>(null);
  const issueIds = useRef(new Set<string>());
  const pending = usePendingSave({ actorId, listPending: noDraftListing });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const id = item.occurrence.id;
  const busy = isBusy(pending.state) || detailBusy;
  const unresolved = ["uncertain", "unsaved"].includes(pending.state.kind);
  const ownDrafts = pendingDrafts.filter(
    (draft) => draft.target_id === id && !consumed.includes(draft.id),
  );
  const focus = () => primary.current?.focus({ preventScroll: true });
  async function refreshReceipt() {
    setDetailBusy(true);
    try {
      const body = await readJson(
        `/api/admin/operations/occurrences/${id}/receipts`,
      );
      if (!active.current) return;
      const receipts = Array.isArray(body.receipts)
        ? (body.receipts as WorkspaceReceipt[])
        : [];
      const occurrence = body.occurrence as
        { effective_receipt_id?: string | null } | undefined;
      const receipt = receipts.find(
        (row) => row.id === occurrence?.effective_receipt_id,
      );
      if (!occurrence || (occurrence.effective_receipt_id && !receipt))
        throw new Error("Current receipt unavailable");
      const currentReceipt =
        receipt ??
        (occurrence.effective_receipt_id === null
          ? (receipts.findLast((row) => row.receipt_kind === "reversal") ??
            null)
          : null);
      setItem((current) => ({ ...current, receipt: currentReceipt }));
      merge({ occurrence });
      setReceiptUnavailable(false);
      setError("");
    } catch {
      if (active.current) {
        setReceiptUnavailable(true);
        setError(
          "Current receipt unavailable. Refresh receipt before another change.",
        );
      }
    } finally {
      if (active.current) {
        setDetailBusy(false);
        requestAnimationFrame(focus);
      }
    }
  }

  async function refreshIssueCount() {
    const body = await readJson(
      `/api/admin/operations/issues?facility_id=${facilityId}&task_instance_id=${id}`,
    );
    if (!active.current) return;
    if (!Array.isArray(body.issues)) throw new Error("Issue count unavailable");
    setItem((current) => ({
      ...current,
      open_issues: (body.issues as Record<string, unknown>[]).filter(
        (issue) => issue.status !== "resolved",
      ).length,
    }));
  }
  function merge(reply: Record<string, unknown>) {
    if (!active.current) return;
    const satisfaction =
      reply.satisfaction && typeof reply.satisfaction === "object"
        ? (reply.satisfaction as Record<string, unknown>)
        : reply;
    const receipt =
      satisfaction.receipt && typeof satisfaction.receipt === "object"
        ? (satisfaction.receipt as WorkspaceReceipt)
        : null;
    const occurrence =
      satisfaction.occurrence && typeof satisfaction.occurrence === "object"
        ? satisfaction.occurrence
        : null;
    setItem((current) => ({
      ...current,
      ...(receipt
        ? { receipt }
        : typeof satisfaction.receipt_evidence_status === "string" &&
            current.receipt
          ? {
              receipt: {
                ...current.receipt,
                evidence_status_current: satisfaction.receipt_evidence_status,
              },
            }
          : {}),
      ...(occurrence
        ? { occurrence: { ...current.occurrence, ...occurrence } }
        : {}),
    }));
  }
  async function accept(state: SaveState) {
    if (!active.current) return;
    if (state.kind === "saved") {
      setReplayed(state.record.replayed);
      if (
        (state.reply.receipt as { receipt_kind?: string } | undefined)
          ?.receipt_kind === "reversal"
      ) {
        setMode("record");
        setMore(false);
        setOutcome("performed");
        setEntry("routine");
        setValues({});
        setReason("");
        setPerformedAt("");
        setPerformerKind("self");
        setPerformer("");
      }
      if (state.record.kind === "receipt") {
        if (state.reply.receipt) merge(state.reply);
        else {
          setDetailBusy(true);
          try {
            const body = await readJson(
              `/api/admin/operations/occurrences/${id}/receipts`,
            );
            if (!active.current) return;
            const receipt = (
              Array.isArray(body.receipts) ? body.receipts : []
            ).find((row: WorkspaceReceipt) => row.id === state.record.id);
            if (!receipt)
              throw new Error(
                "Saved receipt details unavailable. Check history before recording again.",
              );
            merge({ receipt, occurrence: body.occurrence });
          } catch (failure) {
            if (active.current) {
              setReceiptUnavailable(true);
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Saved receipt details unavailable",
              );
            }
          } finally {
            if (active.current) setDetailBusy(false);
          }
        }
      }
      const issue = state.reply.issue as { id?: string } | undefined;
      if (state.record.kind === "issue" || issue?.id) {
        const issueId = issue?.id ?? state.record.id;
        if (!issueIds.current.has(issueId)) {
          issueIds.current.add(issueId);
          if (
            state.record.replayed ||
            !issue?.id ||
            item.open_issues === null
          ) {
            try {
              await refreshIssueCount();
            } catch {
              if (active.current) {
                setItem((current) => ({ ...current, open_issues: null }));
                setError("Issue saved; current issue count unavailable.");
              }
            }
          } else
            setItem((current) => ({
              ...current,
              open_issues:
                current.open_issues === null ? null : current.open_issues + 1,
            }));
        }
      }
    }
    if (active.current) requestAnimationFrame(focus);
  }
  function startMode(next: Mode) {
    if (busy || unresolved) return;
    setMode(next);
    setExpanded(true);
    setError("");
    setReason("");
    if (next === "correct" && item.receipt) {
      setReason(
        typeof item.receipt.entry_reason === "string"
          ? item.receipt.entry_reason
          : "",
      );
      setCorrectionReason("");
      setValues(
        displayValues(
          item.rules?.inputs ?? [],
          (item.receipt.values as Values) ?? {},
          timezone,
        ),
      );
      setOutcome(item.receipt.outcome ?? "performed");
      setMore(true);
      setEntry(String(item.receipt.entry_kind ?? "routine"));
      setPerformedAt(
        typeof item.receipt.performed_at === "string"
          ? formatInTimeZone(
              item.receipt.performed_at,
              timezone,
              "yyyy-MM-dd'T'HH:mm:ss.SSS",
            )
          : "",
      );
      setPerformerKind(String(item.receipt.performer_kind ?? "self"));
      setPerformer(
        String(
          item.receipt.performer_user_id ??
            item.receipt.performer_vendor_id ??
            item.receipt.performer_label ??
            "",
        ),
      );
      if (
        item.receipt.performer_kind === "self" &&
        item.receipt.recorder_id !== actorId &&
        typeof item.receipt.recorder_id === "string"
      ) {
        setPerformerKind("other_staff");
        setPerformer(item.receipt.recorder_id);
        if (item.receipt.entry_kind !== "late") setEntry("on_behalf");
      }
    }
  }
  async function save(selectedMode: Mode = mode) {
    const mode = selectedMode;
    if (
      recordingUnavailable ||
      busy ||
      unresolved ||
      ownDrafts.length ||
      (receiptUnavailable && mode !== "issue")
    )
      return;
    setError("");
    try {
      let payload: Record<string, unknown>;
      if (mode === "issue")
        payload = {
          task_instance_id: id,
          kind: issueKind,
          summary: summary.trim(),
          severity,
        };
      else if (mode === "reverse") {
        if (!reason.trim()) throw new Error("A reason is required");
        payload = { reason: reason.trim() };
      } else {
        if (!item.rules)
          throw new Error("Rules unavailable; recording is unavailable");
        payload = { outcome };
        if (mode === "correct" && typeof item.receipt?.note === "string")
          payload.note = item.receipt.note;
        const inputs = typedValues(
          item.rules.inputs,
          values,
          timezone,
          mode === "correct" ? ((item.receipt?.values as Values) ?? {}) : {},
        );
        if (Object.keys(inputs).length) payload.values = inputs;
        if (more) {
          if (entry !== "routine") payload.entry_kind = entry;
          if (reason.trim()) payload.entry_reason = reason.trim();
          if (performedAt)
            payload.performed_at = typedValues(
              [
                {
                  key: "at",
                  label: "Performed time",
                  type: "datetime",
                  required: true,
                },
              ],
              { at: performedAt },
              timezone,
              mode === "correct" &&
                typeof item.receipt?.performed_at === "string"
                ? { at: item.receipt.performed_at }
                : {},
            ).at;
          if (performerKind !== "self")
            payload.performer = {
              kind: performerKind,
              [performerKind === "other_staff"
                ? "user_id"
                : performerKind === "vendor"
                  ? "vendor_id"
                  : "label"]: performer.trim(),
            };
          if (
            mode === "correct" &&
            performerKind === "vendor" &&
            performer === item.receipt?.performer_vendor_id &&
            typeof item.receipt?.performer_label === "string" &&
            payload.performer
          )
            (payload.performer as Record<string, unknown>).label =
              item.receipt.performer_label;
          if (outcome === "failed")
            payload.issue = {
              kind: "failed_result",
              summary: summary.trim(),
              severity,
            };
        }
        if (mode === "correct") {
          if (!correctionReason.trim())
            throw new Error("A correction reason is required");
          payload.reason = correctionReason.trim();
        }
      }
      const expected =
        mode === "correct" || mode === "reverse"
          ? {
              expected_receipt_id: item.receipt?.id,
              expected_receipt_revision: item.receipt?.revision,
            }
          : {};
      await accept(
        await pending.save({
          request_key: crypto.randomUUID(),
          command:
            mode === "issue"
              ? "report_issue"
              : mode === "correct"
                ? "correct_work"
                : mode === "reverse"
                  ? "reverse_work"
                  : "record_work",
          target_id: id,
          arguments: { payload, ...expected },
        }),
      );
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error ? failure.message : "Save unavailable",
        );
    }
  }
  const canRecord =
    view === "today" &&
    item.rules?.can_record &&
    !item.occurrence.effective_receipt_id &&
    (!item.receipt || item.receipt.receipt_kind === "reversal") &&
    !receiptUnavailable;
  const receiptEditable =
    view !== "upcoming" &&
    item.rules?.can_record &&
    item.receipt?.receipt_kind === "performance" &&
    !item.receipt.superseded_by_receipt_id &&
    !receiptUnavailable;
  const hasInputs = Boolean(item.rules?.inputs.length);
  const applicable =
    item.rules?.evidence.filter(
      (rule) =>
        rule.min_count > 0 &&
        (rule.when === "always" ||
          (rule.when === "on_success" && outcome === "performed") ||
          (rule.when === "on_failure" && outcome === "failed")),
    ) ?? [];
  const hasEvidence = outcome !== "not_performed" && applicable.length > 0;
  const afterReceiptEvidence =
    item.receipt &&
    item.receipt.evidence_status_current === "missing" &&
    !item.receipt.superseded_by_receipt_id &&
    view !== "upcoming";
  const disabled =
    recordingUnavailable || busy || unresolved || ownDrafts.length > 0;
  return (
    <li
      className="space-y-3 rounded-md border border-border bg-card p-4"
      aria-label={item.occurrence.activity_name}
    >
      <div>
        <h3 className="font-semibold">{item.occurrence.activity_name}</h3>
        <p className="text-sm text-muted-foreground">
          {item.occurrence.subject_label} ·{" "}
          {item.occurrence.deadline_at
            ? localTime(item.occurrence.deadline_at, timezone)
            : "Unknown schedule"}
        </p>
        <p>
          Status: {item.occurrence.status}
          {item.occurrence.execution_state
            ? ` · ${item.occurrence.execution_state}`
            : ""}
        </p>
        <p>Open issues: {item.open_issues ?? "unavailable"}</p>
      </div>
      {item.rules === null ? (
        <p role="alert">Rules unavailable. Recording is unavailable.</p>
      ) : null}
      {item.occurrence.effective_receipt_id && !item.receipt ? (
        <p role="alert">
          Current receipt unavailable. Recording is unavailable until it can be
          read.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          ref={primary}
          type="button"
          className={CONTROL}
          aria-expanded={canRecord ? expanded : history}
          disabled={disabled}
          onClick={() => {
            if (canRecord) {
              if (!hasInputs && !hasEvidence && !more) {
                setMode("record");
                void save("record");
              } else startMode("record");
            } else setHistory((current) => !current);
          }}
        >
          {canRecord
            ? item.occurrence.schedule_status === "unknown"
              ? "Record unscheduled work"
              : hasInputs || hasEvidence
                ? "Record work"
                : "Complete"
            : "View receipt history"}
        </button>
        {canRecord && (
          <button
            type="button"
            className={CONTROL}
            aria-expanded={more}
            disabled={disabled}
            onClick={() => {
              if (more) {
                setOutcome("performed");
                setEntry("routine");
                setPerformedAt("");
                setPerformerKind("self");
                setPerformer("");
                setReason("");
              }
              setMore((current) => !current);
              setMode("record");
              setExpanded(true);
            }}
          >
            More options
          </button>
        )}
        <button
          type="button"
          className={CONTROL}
          disabled={disabled}
          onClick={() => startMode("issue")}
        >
          Report an issue
        </button>
        {receiptEditable ? (
          <>
            <button
              type="button"
              className={CONTROL}
              disabled={disabled}
              onClick={() => startMode("correct")}
            >
              Correct
            </button>
            <button
              type="button"
              className={CONTROL}
              disabled={disabled}
              onClick={() => startMode("reverse")}
            >
              Reverse
            </button>
          </>
        ) : null}
      </div>
      {ownDrafts.map((draft) => (
        <div key={draft.id}>
          <p>Earlier save waiting to be checked.</p>
          <button
            type="button"
            className={CONTROL}
            disabled={busy || unresolved}
            onClick={() => {
              setConsumed((ids) => [...ids, draft.id]);
              void pending.adopt(draft).then(accept);
            }}
          >
            Check earlier save
          </button>
        </div>
      ))}
      {expanded && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h4 className="font-semibold">
            {mode === "issue"
              ? "Report an issue"
              : mode === "reverse"
                ? "Reverse entry"
                : mode === "correct"
                  ? "Correct entry"
                  : "Record work"}
          </h4>
          {(mode === "record" || mode === "correct") && (
            <WorkInputs
              timezone={timezone}
              rules={item.rules?.inputs ?? []}
              values={values}
              onChange={setValues}
              prefix={id}
            />
          )}
          {(mode === "record" || mode === "correct") && more ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col">
                Outcome
                <select
                  className={CONTROL}
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                >
                  <option value="performed">Performed</option>
                  <option value="failed">Failed</option>
                  <option value="not_performed">Not performed</option>
                </select>
              </label>
              <label className="flex flex-col">
                Entry type
                <select
                  className={CONTROL}
                  value={entry}
                  onChange={(event) => setEntry(event.target.value)}
                >
                  <option value="routine">Routine</option>
                  <option value="late">Late</option>
                  <option value="on_behalf">On behalf</option>
                </select>
              </label>
              <DateTimeInput
                timezone={timezone}
                id={`${id}-performed`}
                label="Performed time"
                value={performedAt}
                onChange={setPerformedAt}
              />
              <label className="flex flex-col">
                Performer
                <select
                  className={CONTROL}
                  value={performerKind}
                  onChange={(event) => setPerformerKind(event.target.value)}
                >
                  <option value="self">Current person</option>
                  <option value="other_staff">Other staff</option>
                  <option value="vendor">Vendor</option>
                  <option value="unknown_historical">
                    Unknown historical performer
                  </option>
                </select>
              </label>
              {performerKind !== "self" ? (
                <label className="flex flex-col">
                  {performerKind === "unknown_historical"
                    ? "Performer description"
                    : "Performer identifier"}
                  <input
                    className={CONTROL}
                    required
                    value={performer}
                    onChange={(event) => setPerformer(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          {mode === "reverse" || (more && mode === "record") ? (
            <label className="flex flex-col">
              Reason
              <input
                className={CONTROL}
                value={reason}
                required={
                  mode !== "record" ||
                  entry !== "routine" ||
                  outcome === "not_performed"
                }
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
          {mode === "correct" ? (
            <>
              <label className="flex flex-col">
                Correction reason
                <input
                  className={CONTROL}
                  required
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                />
              </label>
              <label className="flex flex-col">
                Entry reason
                <input
                  className={CONTROL}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            </>
          ) : null}
          {mode === "issue" || (outcome === "failed" && mode !== "reverse") ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col">
                Issue summary
                <input
                  className={CONTROL}
                  required
                  maxLength={2000}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              {mode === "issue" ? (
                <label className="flex flex-col">
                  Issue kind
                  <select
                    className={CONTROL}
                    value={issueKind}
                    onChange={(event) => setIssueKind(event.target.value)}
                  >
                    <option value="problem">Problem</option>
                    <option value="help_request">Help request</option>
                    <option value="failed_result">Failed result</option>
                  </select>
                </label>
              ) : null}
              <label className="flex flex-col">
                Severity
                <select
                  className={CONTROL}
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value)}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              className={CONTROL}
              disabled={
                disabled ||
                (receiptUnavailable && mode !== "issue") ||
                (mode === "record" && !canRecord)
              }
            >
              {mode === "issue"
                ? "Save issue"
                : mode === "reverse"
                  ? "Save reversal"
                  : mode === "correct"
                    ? "Save correction"
                    : "Save work"}
            </button>
            <button
              type="button"
              className={CONTROL}
              disabled={busy}
              onClick={() => {
                setExpanded(false);
                setMore(false);
                setMode("record");
                setOutcome("performed");
                setEntry("routine");
                setValues({});
                setReason("");
                setPerformedAt("");
                setPerformerKind("self");
                setPerformer("");
                focus();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <SaveStateNotice
        state={pending.state}
        actorName={actorName ?? actorId}
        className="[&_button]:min-h-11"
        onRetry={() => void pending.retry().then(accept)}
        onCheckAgain={() => void pending.checkAgain().then(accept)}
        onDiscard={() => void pending.discard().then(accept)}
      />
      {item.receipt ||
      item.occurrence.effective_receipt_id ||
      receiptUnavailable ||
      (pending.state.kind === "saved" &&
        pending.state.record.kind === "receipt") ? (
        <button
          type="button"
          className={CONTROL}
          disabled={busy}
          onClick={() => void refreshReceipt()}
        >
          Refresh receipt
        </button>
      ) : null}
      {item.receipt ? (
        <ReceiptSummary
          receipt={item.receipt}
          actorId={actorId}
          actorName={actorName}
          timezone={timezone}
          replayed={replayed}
        />
      ) : null}
      {afterReceiptEvidence ? (
        <EvidencePanel
          key={item.receipt!.id}
          receipt={item.receipt!}
          rules={item.rules?.evidence ?? []}
          actorId={actorId}
          actorName={actorName}
          disabled={disabled || receiptUnavailable || !item.rules?.can_record}
          onResult={(reply) => {
            merge(reply);
            void refreshReceipt();
          }}
        />
      ) : null}
      {item.occurrence.activity_id ? <TaskHelpHandover activityId={item.occurrence.activity_id} facilityId={facilityId} occurrenceId={id} actorId={actorId} timezone={timezone} /> : null}
      {history ? (
        <ReceiptHistory
          occurrenceId={id}
          facilityId={facilityId}
          actorId={actorId}
          actorName={actorName}
          timezone={timezone}
          refresh={`${item.receipt?.id ?? ""}:${String(item.receipt?.revision ?? "")}:${item.open_issues}`}
        />
      ) : null}
    </li>
  );
}
