"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { isOperationsViewRole } from "@/lib/operations/constants";
import {
  listPendingDrafts,
  type DraftSummary,
} from "@/lib/operations/recovery-client";
import type { WorkspaceReply, WorkspaceView } from "@/lib/operations/workspace";
import { PageShell } from "@/design-system/components/PageShell";
import { Panel } from "@/design-system/components/Panel";
import { Note } from "@/design-system/components/Note";
import { WorkRow } from "./_components/work-row";
import { LegacyRow } from "./_components/legacy-row";
import { CONTROL } from "./_components/work-inputs";
import { readJson } from "./_components/receipt-history";

export default function SiteWorkPage() {
  const auth = useHavenAuth();
  const router = useRouter();
  useEffect(() => {
    if (!auth.loading && !isOperationsViewRole(auth.appRole))
      router.replace("/dashboard");
  }, [auth.loading, auth.appRole, router]);
  if (auth.loading) return <p role="status">Loading current person…</p>;
  if (!auth.user || !isOperationsViewRole(auth.appRole))
    return <p>Site work is unavailable for this person.</p>;
  return (
    <PersonWorkspace
      key={`${auth.user.id}:${auth.appRole}`}
      actorId={auth.user.id}
      actorName={auth.fullName}
    />
  );
}

function PersonWorkspace({
  actorId,
  actorName,
}: {
  actorId: string;
  actorName: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const store = useFacilityStore();
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>(
    store.facilitiesCacheUserId === actorId ? store.availableFacilities : [],
  );
  const [facilityError, setFacilityError] = useState("");
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftError, setDraftError] = useState("");
  const [listedDraftScope, setListedDraftScope] = useState<string | null>(null);
  const [draftAttempt, setDraftAttempt] = useState(0);
  const facilityId =
    params.get("facility_id") ??
    (store.facilitiesCacheUserId === actorId
      ? store.selectedFacilityId
      : null) ??
    "";
  const view: WorkspaceView =
    params.get("view") === "upcoming"
      ? "upcoming"
      : params.get("view") === "history"
        ? "history"
        : "today";
  const mine = params.get("mine") === "1";
  const cursor = view === "history" ? params.get("cursor") : null;
  const draftScope = `${facilityId}:${view}:${mine}:${cursor ?? ""}`;
  const [renderedDraftScope, setRenderedDraftScope] = useState(draftScope);
  if (renderedDraftScope !== draftScope) {
    setRenderedDraftScope(draftScope);
    setListedDraftScope(null);
  }
  const draftLoading =
    listedDraftScope !== draftScope || renderedDraftScope !== draftScope;
  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    next.set("facility_id", facilityId);
    next.set("view", view);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`/admin/operations/work?${next}`, { scroll: false });
  }
  useEffect(() => {
    let active = true;
    void fetchAdminFacilityOptions()
      .then((rows) => {
        if (active) setFacilities(rows);
      })
      .catch(() => {
        if (active) setFacilityError("Site options unavailable");
      });
    return () => {
      active = false;
    };
  }, [actorId]);
  useEffect(() => {
    let active = true;
    void listPendingDrafts().then((answer) => {
      if (!active) return;
      setListedDraftScope(draftScope);
      if (answer.kind === "ok") {
        setDrafts(answer.body.drafts);
        setDraftError("");
      } else
        setDraftError(
          "Earlier saves could not be loaded. Check again before recording new work.",
        );
    });
    return () => {
      active = false;
    };
  }, [actorId, draftAttempt, draftScope]);
  const filters = (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <label className="flex flex-col gap-1">
        Site
        <select
          className={CONTROL}
          value={facilityId}
          onChange={(event) =>
            navigate({ facility_id: event.target.value, cursor: null })
          }
        >
          <option value="">Choose a site</option>
          {facilityId &&
          !facilities.some((facility) => facility.id === facilityId) ? (
            <option value={facilityId}>Selected site</option>
          ) : null}
          {facilities.map((facility) => (
            <option key={facility.id} value={facility.id}>
              {facility.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2" aria-label="Work views">
        {(["today", "upcoming", "history"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            className={CONTROL}
            aria-pressed={view === tab}
            onClick={() => navigate({ view: tab, cursor: null })}
          >
            {tab === "today"
              ? "Today"
              : tab === "upcoming"
                ? "Upcoming"
                : "History"}
          </button>
        ))}
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={mine}
          onChange={(event) =>
            navigate({ mine: event.target.checked ? "1" : null, cursor: null })
          }
        />
        Mine
      </label>
    </div>
  );
  return (
    <div className="space-y-4">
      {facilityError ? <p role="alert">{facilityError}</p> : null}
      {draftError ? (
        <div>
          <p role="alert">{draftError}</p>
          <button
            type="button"
            className={CONTROL}
            onClick={() => {
              setListedDraftScope(null);
              setDraftAttempt((n) => n + 1);
            }}
          >
            Check earlier saves again
          </button>
        </div>
      ) : null}
      <WorkspaceData
        key={`${actorId}:${facilityId}:${view}:${mine}:${cursor ?? ""}`}
        facilityId={facilityId}
        actorId={actorId}
        actorName={actorName}
        view={view}
        mine={mine}
        cursor={cursor}
        filters={filters}
        drafts={drafts}
        draftsUnavailable={draftLoading || Boolean(draftError)}
        onNext={(next) => navigate({ cursor: next })}
      />
    </div>
  );
}

function WorkspaceData({
  facilityId,
  actorId,
  actorName,
  view,
  mine,
  cursor,
  filters,
  drafts,
  draftsUnavailable,
  onNext,
}: {
  facilityId: string;
  actorId: string;
  actorName: string | null;
  view: WorkspaceView;
  mine: boolean;
  cursor: string | null;
  filters: React.ReactNode;
  drafts: DraftSummary[];
  draftsUnavailable: boolean;
  onNext: (cursor: string | null) => void;
}) {
  const [reply, setReply] = useState<WorkspaceReply | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!facilityId) return;
    let active = true;
    const query = new URLSearchParams({
      facility_id: facilityId,
      view,
      ...(mine ? { mine: "1" } : {}),
      ...(cursor ? { cursor } : {}),
    });
    void readJson(`/api/admin/operations/workspace?${query}`)
      .then((body) => {
        if (!active) return;
        const result = body as unknown as WorkspaceReply;
        if (result.actor?.id !== actorId || result.facility_id !== facilityId)
          throw new Error("Current person changed. Reload this workspace.");
        setReply(result);
        setError("");
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Workspace unavailable",
          );
      });
    return () => {
      active = false;
    };
  }, [facilityId, actorId, view, mine, cursor, attempt]);
  const timezone = reply?.facility_timezone ?? "America/New_York";
  const groups = reply
    ? "due_today" in reply.groups
      ? [
          { title: "Due today", rows: reply.groups.due_today },
          { title: "Outstanding from earlier", rows: reply.groups.outstanding },
          { title: "Unknown schedule", rows: reply.groups.unknown_schedule },
        ]
      : "upcoming" in reply.groups
        ? [
            {
              title: "Upcoming · next fourteen days",
              rows: reply.groups.upcoming,
            },
          ]
        : [{ title: "History", rows: reply.groups.history }]
    : [];
  return (
    <PageShell
      title="Site work"
      subtitle={`Current person: ${actorName ?? actorId}`}
      filters={filters}
      audit={{
        auditHref: `/admin/operations/work?facility_id=${facilityId}&view=history`,
        updatedAt: reply?.generated_at ?? new Date(),
        timezone,
        live: Boolean(reply) && !error,
        className: "[&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center",
      }}
    >
      <div className="space-y-4">
        <Note tone="info">
          Use Sign out in the account menu before another person uses this
          device. Site shows all work by default, including unassigned duties.
        </Note>
        {!facilityId ? (
          <p>Choose a site to see its work.</p>
        ) : error ? (
          <div>
            <p role="alert">{error}</p>
            <button
              type="button"
              className={CONTROL}
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry workspace
            </button>
          </div>
        ) : !reply ? (
          <p role="status">Loading site work…</p>
        ) : (
          <>
            {reply.partial.length ? (
              <p role="alert">
                Some workspace details failed to load:{" "}
                {reply.partial.join(", ")}. Available work is shown below.
              </p>
            ) : null}
            {"history" in reply.groups ? (
              <p>
                {reply.groups.total === null
                  ? "Site history total unavailable"
                  : `${reply.groups.total} total entries across this site`}
                {mine ? " · Mine filter applied to this page" : ""}
              </p>
            ) : null}
            {groups.map((group) => (
              <Panel key={group.title} title={group.title}>
                {group.rows.length === 0 ? (
                  <p>No work in this view.</p>
                ) : (
                  <ul className="space-y-3">
                    {group.rows.map((item) => (
                      <WorkRow
                        key={item.occurrence.id}
                        item={item}
                        recordingUnavailable={draftsUnavailable}
                        facilityId={facilityId}
                        actorId={actorId}
                        actorName={actorName ?? reply.actor.name}
                        timezone={timezone}
                        view={view}
                        pendingDrafts={drafts}
                      />
                    ))}
                  </ul>
                )}
              </Panel>
            ))}
            {"legacy" in reply.groups ? (
              <Panel title="Legacy tasks">
                {reply.partial.includes("legacy") ? (
                  <p role="alert">Legacy tasks unavailable.</p>
                ) : reply.groups.legacy.length === 0 ? (
                  <p>No unfinished legacy tasks.</p>
                ) : (
                  <ul className="space-y-3">
                    {reply.groups.legacy.map((task) => (
                      <LegacyRow
                        key={task.id}
                        task={task}
                        actorName={actorName ?? actorId}
                      />
                    ))}
                  </ul>
                )}
              </Panel>
            ) : null}
            {"history" in reply.groups ? (
              <div className="flex gap-2">
                {cursor ? (
                  <button
                    type="button"
                    className={CONTROL}
                    onClick={() => onNext(null)}
                  >
                    First page
                  </button>
                ) : null}
                {reply.groups.next_cursor ? (
                  <button
                    type="button"
                    className={CONTROL}
                    onClick={() =>
                      onNext(
                        reply.groups && "next_cursor" in reply.groups
                          ? reply.groups.next_cursor
                          : null,
                      )
                    }
                  >
                    Next page
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
