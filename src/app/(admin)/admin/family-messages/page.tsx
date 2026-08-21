"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { NamedAdminRouteLoading } from "@/components/layout/named-admin-route-loading";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import type {
  FamilyDeliveryMethod,
  StaffMessageRow,
  StaffMessageThread,
} from "@/lib/admin/family-messages-data";
import {
  FAMILY_BULLETIN_EMPTY_DESCRIPTION,
  FAMILY_BULLETIN_EMPTY_TITLE,
  FAMILY_BULLETIN_PAGE_DESCRIPTION,
  FAMILY_BULLETIN_PAGE_TITLE,
  FAMILY_BULLETIN_RESIDENT_EMPTY_DESCRIPTION,
  FAMILY_BULLETIN_RESIDENT_EMPTY_TITLE,
  FAMILY_BULLETIN_RESIDENT_LOG_LOADING_MESSAGE,
} from "@/lib/admin/family-messages-copy";
import { ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  fetchStaffMessageThreads,
  fetchStaffMessagesForResident,
  postStaffMessage,
} from "@/lib/admin/family-messages-data";
import { formatFamilyDeliveryMethod } from "@/lib/family/family-portal-notes-display";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { FamilyPortalUpdateLog } from "@/components/family-portal/FamilyPortalUpdateLog";
import { StaffFamilyBulletinSection } from "@/components/family-portal/StaffFamilyBulletinSection";

function bulletinItemsFromMessages(messages: StaffMessageRow[]) {
  return [...messages]
    .reverse()
    .map((message) => ({
      id: message.id,
      body: message.body,
      timestamp: message.createdAt,
      authorLabel:
        message.authorKind === "staff"
          ? message.authorName
          : `${message.authorName} (legacy)`,
      deliveryMethod:
        message.authorKind === "staff" ? message.deliveryMethod : undefined,
      familyAcknowledgedAt: message.familyAcknowledgedAt,
      variant: message.authorKind,
    }));
}

export default function StaffFamilyMessagesPage() {
  const { user } = useHavenAuth();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState<StaffMessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [composeResidentId, setComposeResidentId] = useState("");
  const [messages, setMessages] = useState<StaffMessageRow[]>([]);
  const [residentName, setResidentName] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<FamilyDeliveryMethod>("portal_only");
  const [posting, setPosting] = useState(false);
  const [residentFilter, setResidentFilter] = useState<"all" | "triage">("all");
  const [triageActionLoading, setTriageActionLoading] = useState<string | null>(null);
  const [triageActionError, setTriageActionError] = useState<string | null>(null);
  const [triageActionMessage, setTriageActionMessage] = useState<string | null>(null);
  const requestedFilter = searchParams.get("filter");

  useEffect(() => {
    if (requestedFilter === "triage") {
      setResidentFilter("triage");
      return;
    }
    setResidentFilter("all");
  }, [requestedFilter]);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await fetchStaffMessageThreads(supabase);
      if (!result.ok) setError(result.error);
      else setThreads(result.threads);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bulletin notes");
    } finally {
      setLoading(false);
    }
  }, []);

  const openResidentLog = useCallback(async (residentId: string) => {
    setSelectedResidentId(residentId);
    setComposeResidentId(residentId);
    setMsgLoading(true);
    setMsgError(null);
    try {
      const supabase = createClient();
      const result = await fetchStaffMessagesForResident(supabase, residentId);
      if (!result.ok) {
        setMsgError(result.error);
      } else {
        setMessages(result.messages);
        setResidentName(result.residentName);
      }
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : "Failed to load posted updates");
    } finally {
      setMsgLoading(false);
    }
  }, []);

  const activeComposeResidentId = selectedResidentId ?? composeResidentId;

  const handlePost = useCallback(async () => {
    if (!activeComposeResidentId || !draft.trim() || posting) return;
    setPosting(true);
    setMsgError(null);
    try {
      const supabase = createClient();
      const result = await postStaffMessage(supabase, activeComposeResidentId, draft, deliveryMethod);
      if (!result.ok) {
        setMsgError(result.error);
      } else {
        setDraft("");
        if (selectedResidentId) {
          await openResidentLog(selectedResidentId);
        }
        await loadThreads();
      }
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : "Failed to post bulletin note");
    } finally {
      setPosting(false);
    }
  }, [activeComposeResidentId, draft, deliveryMethod, posting, openResidentLog, selectedResidentId, loadThreads]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const visibleThreads = threads.filter((thread) => {
    if (residentFilter === "triage") {
      return thread.triageStatus === "pending_review" || thread.triageStatus === "in_review";
    }
    return true;
  });
  const selectedThread = selectedResidentId
    ? threads.find((thread) => thread.residentId === selectedResidentId) ?? null
    : null;

  const composeThread = useMemo(
    () => threads.find((thread) => thread.residentId === activeComposeResidentId) ?? null,
    [activeComposeResidentId, threads],
  );

  const updateThreadTriageStatus = useCallback(
    async (
      triageItemId: string,
      triageStatus: "in_review" | "resolved" | "false_positive",
      successMessage: string,
    ) => {
      setTriageActionLoading(triageItemId);
      setTriageActionError(null);
      setTriageActionMessage(null);
      try {
        const supabase = createClient();
        if (!user?.id) {
          setTriageActionError("You must be signed in to update triage.");
          return;
        }
        const { error: updateError } = await supabase
          .from("family_message_triage_items")
          .update({
            triage_status: triageStatus,
            reviewed_at:
              triageStatus === "resolved" || triageStatus === "false_positive"
                ? new Date().toISOString()
                : null,
            reviewed_by:
              triageStatus === "resolved" || triageStatus === "false_positive"
                ? user.id
                : null,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
          })
          .eq("id", triageItemId);
        if (updateError) throw updateError;
        setTriageActionMessage(successMessage);
        await loadThreads();
        if (selectedResidentId) {
          await openResidentLog(selectedResidentId);
        }
      } catch (err) {
        setTriageActionError(err instanceof Error ? err.message : "Could not update triage.");
      } finally {
        setTriageActionLoading(null);
      }
    },
    [loadThreads, openResidentLog, selectedResidentId, user?.id],
  );

  if (loading) {
    return <NamedAdminRouteLoading message={ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE} />;
  }

  if (error) {
    return (
      <div className="mx-auto mt-20 flex max-w-3xl flex-col items-center gap-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-6 text-sm font-medium text-rose-700 dark:text-rose-400">
        {error}
        <Button variant="outline" size="sm" onClick={() => { void loadThreads(); }}>
          Try again
        </Button>
      </div>
    );
  }

  if (selectedResidentId) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 pb-12">
        <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => {
                setSelectedResidentId(null);
                setMessages([]);
                void loadThreads();
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Back to bulletin notes"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <p className="text-xs text-muted-foreground">Family portal bulletin log</p>
              <h2 className="text-2xl font-medium tracking-tight text-foreground">
                {residentName}
              </h2>
              {selectedThread?.triageStatus ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs",
                      selectedThread.triageStatus === "pending_review"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        : selectedThread.triageStatus === "in_review"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : selectedThread.triageStatus === "resolved"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    Triage: {selectedThread.triageStatus.replace(/_/g, " ")}
                  </span>
                  {selectedThread.triageKeywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs text-rose-700 dark:text-rose-300"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {triageActionError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {triageActionError}
          </p>
        ) : null}
        {triageActionMessage ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            {triageActionMessage}
          </p>
        ) : null}

        {selectedThread?.triageItemId ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                triageActionLoading === selectedThread.triageItemId ||
                selectedThread.triageStatus === "in_review"
              }
              onClick={() =>
                void updateThreadTriageStatus(
                  selectedThread.triageItemId as string,
                  "in_review",
                  "Triage moved to in review.",
                )
              }
            >
              In review
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                triageActionLoading === selectedThread.triageItemId ||
                selectedThread.triageStatus === "resolved"
              }
              onClick={() =>
                void updateThreadTriageStatus(
                  selectedThread.triageItemId as string,
                  "resolved",
                  "Triage resolved.",
                )
              }
            >
              Resolve
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                triageActionLoading === selectedThread.triageItemId ||
                selectedThread.triageStatus === "false_positive"
              }
              onClick={() =>
                void updateThreadTriageStatus(
                  selectedThread.triageItemId as string,
                  "false_positive",
                  "Triage marked false positive.",
                )
              }
            >
              False positive
            </Button>
          </div>
        ) : null}

        <StaffFamilyBulletinSection
          residentId={selectedResidentId}
          lastPostedAtIso={selectedThread?.lastMessageAtIso ?? null}
          draft={draft}
          deliveryMethod={deliveryMethod}
          posting={posting}
          error={msgError}
          onDraftChange={setDraft}
          onDeliveryMethodChange={setDeliveryMethod}
          onPost={() => { void handlePost(); }}
        />

        {msgLoading ? (
          <FamilyPortalUpdateLog
            items={[]}
            loading
            loadingMessage={FAMILY_BULLETIN_RESIDENT_LOG_LOADING_MESSAGE}
            listLabel="Posted bulletin notes"
          />
        ) : (
          <FamilyPortalUpdateLog
            items={bulletinItemsFromMessages(messages)}
            emptyTitle={FAMILY_BULLETIN_RESIDENT_EMPTY_TITLE}
            emptyDescription={FAMILY_BULLETIN_RESIDENT_EMPTY_DESCRIPTION}
            listLabel="Posted bulletin notes"
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 pb-12">
      <div className="mt-4 rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {FAMILY_BULLETIN_PAGE_TITLE}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {FAMILY_BULLETIN_PAGE_DESCRIPTION}
        </p>
      </div>

      <StaffFamilyBulletinSection
        residentId={composeResidentId}
        onResidentChange={(residentId) => {
          setComposeResidentId(residentId);
          setMsgError(null);
        }}
        lastPostedAtIso={composeThread?.lastMessageAtIso ?? null}
        draft={draft}
        deliveryMethod={deliveryMethod}
        posting={posting}
        error={msgError}
        onDraftChange={setDraft}
        onDeliveryMethodChange={setDeliveryMethod}
        onPost={() => { void handlePost(); }}
      />

      {threads.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-border bg-muted/20 p-16 text-center"
          role="status"
        >
          <ClipboardList className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-medium text-foreground">{FAMILY_BULLETIN_EMPTY_TITLE}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {FAMILY_BULLETIN_EMPTY_DESCRIPTION}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 px-1">
            <h2 className="text-lg font-medium text-foreground">Posted bulletin notes</h2>
            {residentFilter !== "all" ? (
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {visibleThreads.length} shown
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 px-1">
            {[
              { key: "all", label: `All (${threads.length})` },
              {
                key: "triage",
                label: `Needs review (${threads.filter((thread) => thread.triageStatus === "pending_review" || thread.triageStatus === "in_review").length})`,
              },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setResidentFilter(option.key as "all" | "triage")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  residentFilter === option.key
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {residentFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                Filter: {residentFilter}
              </span>
              <Link
                href="/admin/family-messages"
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Clear filter
              </Link>
            </div>
          ) : null}

          <MotionList className="grid gap-4 sm:grid-cols-2">
            {visibleThreads.length === 0 ? (
              <div className="col-span-full rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
                No residents match this filter.
              </div>
            ) : (
              visibleThreads.map((thread) => (
                <MotionItem key={thread.residentId}>
                  <button
                    type="button"
                    className="group w-full rounded-lg border border-border bg-card p-6 text-left shadow-sm transition-colors hover:bg-muted/40"
                    onClick={() => { void openResidentLog(thread.residentId); }}
                  >
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <h3 className="text-xl font-semibold tracking-tight text-foreground group-hover:text-primary">
                          {thread.residentName}
                        </h3>
                        <p className="text-sm text-muted-foreground">{thread.roomLabel}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-xs text-muted-foreground">
                          {thread.lastMessageAt}
                        </span>
                        {thread.triageStatus === "pending_review" ? (
                          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs text-rose-700 dark:text-rose-300">
                            Needs review
                          </span>
                        ) : thread.triageStatus === "in_review" ? (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                            In review
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-md border border-border/70 bg-muted/20 p-4">
                      <p className="line-clamp-3 text-sm leading-relaxed text-foreground">
                        {thread.lastMessageBody}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {formatFamilyDeliveryMethod(thread.latestDeliveryMethod)}
                      </p>
                      {thread.latestFamilyAcknowledgedAt ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Family viewed{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(thread.latestFamilyAcknowledgedAt))}
                        </p>
                      ) : null}
                      {thread.triageKeywords.length > 0 ? (
                        <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                          {thread.triageKeywords.join(", ")}
                        </p>
                      ) : null}
                    </div>

                    <p className="mt-4 text-xs text-muted-foreground">
                      {thread.messageCount} bulletin note{thread.messageCount !== 1 ? "s" : ""}
                    </p>
                  </button>
                </MotionItem>
              ))
            )}
          </MotionList>
        </div>
      )}
    </div>
  );
}
