"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { isOperationsViewRole } from "@/lib/operations/constants";
import type {
  AttentionCategory,
  AttentionItem,
  NeedsAttentionReply,
} from "@/lib/operations/needs-attention";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { ReceiptHistory, localTime } from "../work/_components/receipt-history";
import { CONTROL } from "../work/_components/work-inputs";
import { enumLabel } from "@/lib/display/enum-label";
import { OPERATIONS_NO_FACILITY_COPY } from "@/lib/operations/operations-display-copy";

const CATEGORIES: Record<AttentionCategory, string> = {
  overdue: "Overdue",
  unresolved_issues: "Unresolved issues",
  missing_evidence: "Missing evidence",
  waiting: "Waiting",
  unassigned: "Unassigned",
  configuration_needed: "Configuration needed",
};

export default function NeedsAttentionPage() {
  const auth = useHavenAuth();
  const router = useRouter();
  const allowed = isOperationsViewRole(auth.appRole);
  useEffect(() => {
    if (!auth.loading && !allowed) router.replace("/dashboard");
  }, [auth.loading, allowed, router]);
  if (auth.loading) return <p role="status">Loading current person…</p>;
  if (!auth.user || !allowed)
    return <p>Needs attention is unavailable for this person.</p>;
  return (
    <PersonAttention
      key={`${auth.user.id}:${auth.appRole}`}
      actorId={auth.user.id}
      actorName={auth.fullName}
    />
  );
}

function PersonAttention({
  actorId,
  actorName,
}: {
  actorId: string;
  actorName: string | null;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const facilityId = params.get("facility_id") ?? "";
  const category = params.get("category") ?? "";
  const cursor = params.get("cursor") ?? "";
  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`/admin/operations/attention?${next}`, { scroll: false });
  }
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Needs attention</h1>
        <p className="max-w-3xl text-muted-foreground">
          Review overdue work, unresolved issues and missing information across
          the facilities you can access.
        </p>
      </header>
      <OperationsViewNav />
      <AttentionScope
        key={`${facilityId}:${category}:${cursor}`}
        facilityId={facilityId}
        category={category}
        cursor={cursor}
        actorId={actorId}
        actorName={actorName}
        navigate={navigate}
      />
    </div>
  );
}

type ScopeProps = {
  facilityId: string;
  category: string;
  cursor: string;
  actorId: string;
  actorName: string | null;
  navigate: (changes: Record<string, string | null>) => void;
};
function AttentionScope({
  facilityId,
  category,
  cursor,
  actorId,
  actorName,
  navigate,
}: ScopeProps) {
  const [body, setBody] = useState<NeedsAttentionReply | null>(null);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (facilityId) query.set("facility_id", facilityId);
    if (category) query.set("category", category);
    if (cursor) query.set("cursor", cursor);
    void fetch(`/api/admin/operations/needs-attention?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 409) {
            if (!controller.signal.aborted) setChanged(true);
            throw new Error(
              "Attention records changed. Reload the first page to reconcile counts and details.",
            );
          }
          throw new Error(
            response.status === 403 || response.status === 404
              ? "This attention view is no longer accessible."
              : "Needs attention is unavailable. Counts are not confirmed zero.",
          );
        }
        return (await response.json()) as NeedsAttentionReply;
      })
      .then((reply) => {
        if (!controller.signal.aborted) {
          setBody(reply);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setBody(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "Needs attention is unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [facilityId, category, cursor, attempt]);
  if (error)
    return (
      <div role="alert" className="space-y-3">
        <p>{error}</p>
        {changed ? (
          <button
            className={CONTROL}
            onClick={() => {
              if (cursor) navigate({ cursor: null });
              else {
                setChanged(false);
                setError("");
                setAttempt((n) => n + 1);
              }
            }}
          >
            Reload first page
          </button>
        ) : (
          <button
            className={CONTROL}
            onClick={() => {
              setError("");
              setAttempt((n) => n + 1);
            }}
          >
            Retry attention
          </button>
        )}
      </div>
    );
  if (!body) return <p role="status">Loading attention counts and details…</p>;
  const uncertain =
    body.partial.length > 0 ||
    body.total === null ||
    body.high_severity_issues === null ||
    Object.values(body.counts).some(
      (count) => count.count === null || count.denominator === null,
    );
  const confirmedClear =
    body.all_clear &&
    body.facilities.length > 0 &&
    !uncertain &&
    body.total === 0 &&
    Object.values(body.counts).every((count) => count.count === 0);
  return (
    <section aria-label="Attention overview" className="space-y-5">
      <label className="flex max-w-lg flex-col gap-1">
        Facility
        <select
          className={CONTROL}
          value={facilityId}
          onChange={(event) =>
            navigate({ facility_id: event.target.value, cursor: null })
          }
        >
          <option value="">All permitted facilities</option>
          {facilityId &&
          !body.facilities.some((row) => row.id === facilityId) ? (
            <option value={facilityId}>{OPERATIONS_NO_FACILITY_COPY}</option>
          ) : null}
          {body.facilities.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      {body.facilities.length === 0 ? <p>No accessible facilities.</p> : null}
      {uncertain ? (
        <p role="alert" className="rounded-md border border-amber-500 p-3">
          Some attention information is unavailable
          {body.partial.length ? `: ${partialLabels(body).join("; ")}` : ""}.
          Unknown counts are not zero; a complete assessment is unavailable.
        </p>
      ) : null}
      <p className="rounded-md border border-border bg-background p-3 font-semibold">
        High severity unresolved issues:{" "}
        {body.high_severity_issues ?? "Unavailable"}
      </p>
      <p className="text-sm text-muted-foreground">
        Categories overlap. An unresolved issue can also be waiting or
        unassigned. Counts describe each category’s stated population; they are
        not a combined percentage.
      </p>
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Attention categories"
      >
        {(Object.keys(CATEGORIES) as AttentionCategory[]).map((key) => {
          const count = body.counts[key];
          return (
            <button
              key={key}
              className={`space-y-2 rounded-md border p-4 text-left ${category === key ? "border-primary bg-primary/5" : "border-border bg-background"}`}
              aria-pressed={category === key}
              onClick={() => navigate({ category: key, cursor: null })}
            >
              <span className="block font-semibold">{CATEGORIES[key]}</span>
              <span className="block text-2xl font-semibold">
                {count.count ?? "Unavailable"}
              </span>
              <span className="block text-sm">
                Population: {count.denominator ?? "Unavailable"} {count.unit}
              </span>
              <span className="block text-sm text-muted-foreground">
                {count.definition}
              </span>
            </button>
          );
        })}
      </div>
      {confirmedClear ? (
        <p>No attention items found in the checked populations.</p>
      ) : null}
      <section aria-label="Attention details" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">
            {CATEGORIES[category as AttentionCategory] ?? "All attention items"}
          </h2>
          {category ? (
            <button
              className={CONTROL}
              onClick={() => navigate({ category: null, cursor: null })}
            >
              Show all categories
            </button>
          ) : null}
        </div>
        <p>
          Matching records: {body.total ?? "Unavailable"}. This page shows{" "}
          {body.items.length}.
        </p>
        {body.items.length === 0 ? (
          <p>
            {uncertain
              ? "No details loaded; this does not confirm an empty queue."
              : cursor
                ? "No further records on this page."
                : "No matching records in this selection."}
          </p>
        ) : (
          <ul className="space-y-3">
            {body.items.map((item) => (
              <AttentionRow
                key={item.key}
                item={item}
                actorId={actorId}
                actorName={actorName}
                refresh={String(attempt)}
              />
            ))}
          </ul>
        )}
        <nav aria-label="Attention pages" className="flex gap-2">
          {cursor ? (
            <button
              className={CONTROL}
              onClick={() => navigate({ cursor: null })}
            >
              First page
            </button>
          ) : null}
          {body.next_cursor ? (
            <button
              className={CONTROL}
              onClick={() => navigate({ cursor: body.next_cursor })}
            >
              Next page
            </button>
          ) : null}
        </nav>
      </section>
    </section>
  );
}
function partialLabels(body: NeedsAttentionReply): string[] {
  const sources: Record<string, string> = {
    occurrences: "work details unavailable",
    receipts: "evidence details unavailable",
    receipt: "evidence details unavailable",
    issues: "issue details unavailable",
    requirements: "requirements and applicability unavailable",
    ownership: "assignment details unavailable",
  };
  return [
    ...new Set(
      body.partial.map((entry) => {
        const [facilityId, source] = entry.split(":");
        const facility =
          body.facilities.find((row) => row.id === facilityId)?.name ??
          "Facility";
        return `${facility}: ${sources[source] ?? "attention details unavailable"}`;
      }),
    ),
  ];
}

function plain(value: string) {
  return enumLabel(value);
}
function display(value: unknown, fallback = "Unavailable") {
  return typeof value === "string" && value ? plain(value) : fallback;
}
function AttentionRow({
  item,
  actorId,
  actorName,
  refresh,
}: {
  item: AttentionItem;
  actorId: string;
  actorName: string | null;
  refresh: string;
}) {
  const [open, setOpen] = useState(false);
  const detail = item.detail;
  return (
    <li
      id={`attention-${item.key}`}
      className="space-y-2 rounded-md border border-border bg-background p-4"
    >
      <h3 className="font-semibold">
        {item.activity_name} · {item.facility_name}
      </h3>
      <p>{item.reason}</p>
      <p>
        Status: {plain(item.status)}
        {item.severity ? ` · Severity: ${plain(item.severity)}` : ""}
      </p>
      <p className="text-sm">
        {item.categories.map((key) => CATEGORIES[key]).join(" · ")}
      </p>
      {item.source_kind === "issue" ? (
        <p>
          Issue remains unresolved independently of whether the linked work was
          performed.
        </p>
      ) : null}
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer font-medium">
          View exact{" "}
          {item.source_kind === "configuration"
            ? "configuration"
            : item.source_kind === "issue"
              ? "issue"
              : "work"}{" "}
          details
        </summary>
        {open ? (
          <div className="space-y-3 pt-3">
            {item.source_kind === "issue" ? (
              <dl className="space-y-2">
                <div>
                  <dt className="font-medium">Issue</dt>
                  <dd>{display(detail.summary, item.reason)}</dd>
                </div>
                <div>
                  <dt className="font-medium">Owner</dt>
                  <dd>
                    {display(
                      detail.owner_name,
                      display(
                        detail.owner_role,
                        detail.owner_user_id
                          ? "Assigned person — name unavailable"
                          : "Unassigned",
                      ),
                    )}
                    {typeof detail.owner_current === "boolean"
                      ? detail.owner_current
                        ? " · Current"
                        : " · No current owner"
                      : " · Current authority unavailable"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Next action</dt>
                  <dd>{display(detail.next_action, "Action not specified")}</dd>
                </div>
                {detail.waiting_reason ? (
                  <div>
                    <dt className="font-medium">Waiting reason</dt>
                    <dd>{display(detail.waiting_reason)}</dd>
                  </div>
                ) : null}
                {detail.follow_up_at ? (
                  <div>
                    <dt className="font-medium">Follow-up</dt>
                    <dd>
                      {localTime(detail.follow_up_at, item.facility_timezone)} (
                      {item.facility_timezone})
                      {detail.follow_up_overdue === true ? " · Overdue" : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : item.source_kind === "configuration" ? (
              <dl className="space-y-2">
                <div>
                  <dt className="font-medium">Applicability</dt>
                  <dd>{display(detail.applicability, "Unknown")}</dd>
                </div>
                <div>
                  <dt className="font-medium">Schedule</dt>
                  <dd>{display(detail.schedule_status, "Unknown")}</dd>
                </div>
                <div>
                  <dt className="font-medium">Requirement</dt>
                  <dd>
                    {display(
                      detail.requirement_version_id,
                      "No published requirement identified",
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Configuration reason</dt>
                  <dd>
                    {Array.isArray(detail.reasons)
                      ? detail.reasons.map(String).map(plain).join("; ")
                      : item.reason}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>
                Completion state: {display(detail.execution_state)}. Due:{" "}
                {detail.due_at
                  ? `${localTime(detail.due_at, item.facility_timezone)} (${item.facility_timezone})`
                  : "Unknown due date"}
                .
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Record: {item.source_id}
              {item.activity_id ? ` · Activity: ${item.activity_id}` : ""}
            </p>
            {item.task_id ? (
              <ReceiptHistory
                occurrenceId={item.task_id}
                facilityId={item.facility_id}
                actorId={actorId}
                actorName={actorName}
                timezone={item.facility_timezone}
                refresh={refresh}
              />
            ) : (
              <p>No linked work occurrence.</p>
            )}
          </div>
        ) : null}
      </details>
    </li>
  );
}
