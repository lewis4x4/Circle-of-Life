"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import {
  FLOOR_ANYTHING_WRONG_OPTIONS,
  FLOOR_HELPED_WITH_OPTIONS,
  FLOOR_QUICK_STATUS_OPTIONS,
  buildFloorCompletionPayload,
  checkQuestion,
  emptyFloorCheckDraft,
  floorCheckGaps,
  residentPronoun,
  toggleValue,
  type FloorCheckDraft,
} from "@/lib/floor/check-form";
import { FloorOperatorError, claimFloorCheck, currentRetryOwner, saveFloorCheck } from "@/lib/floor/check-submit";
import {
  OBSERVATION_CHIP_GROUPS,
  OBSERVATION_CHIP_GROUP_HEADINGS,
  isObservationChipSelected,
  toggleObservationChip,
  type ObservationVocabOption,
} from "@/lib/rounding/observation-chips";
import { dropFloorCache } from "@/lib/floor/memory-cache";
import { resolveFloorRetryOwner } from "@/lib/floor/retry-owner";
import { FLOOR_CHECK_NAME, checkTiming } from "@/lib/floor/now-rows";
import { formatDisplayTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

import { ChoiceChip, ChoiceGroup } from "./ChoiceChip";
import { useFloorSession } from "./FloorContext";
import { useFloorNow } from "./FloorClock";
import { StatusReadError } from "./FloorResidentsRail";
import { FloorScreenHeader } from "./FloorScreenHeader";
import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_FOCUS_RING, FLOOR_OUTLINE_BUTTON, FLOOR_PRIMARY_BUTTON } from "./floor-styles";
import { useFloorCheckData, type FloorCheckData } from "./useFloorCheckData";

/**
 * `/floor/check/[taskId]` (spec 40 §6 screen 5, DESIGN.md 05): chart one check
 * with chips. How they are, where, what they are doing and at least one meal,
 * mood or medication chip are required, as the database requires for a Smart
 * Rounding check; why late is required once the check is over. Saves through
 * the caregiver completion route, or the offline queue.
 */
export function FloorCheckScreen({ taskId }: { taskId: string }) {
  const { state, reload } = useFloorCheckData(taskId);
  if (state.status === "idle" || state.status === "loading") return <FloorStatePanel state="loading" title="Opening the check" pageTitle="Safety check" className="flex-1" />;
  if (state.status === "error") return <FloorStatePanel state="error" title="This check could not open." detail="Check the Wi-Fi, then try again." onRetry={reload} pageTitle="Safety check" className="flex-1" />;
  if (!state.data) {
    return (
      <FloorStatePanel state="empty" title="This check is not on the list any more." detail="It may be charted already. Go back to Now." pageTitle="Safety check" className="flex-1" />
    );
  }
  return <CheckForm key={taskId} data={state.data} onRetry={reload} />;
}

function CheckForm({ data, onRetry }: { data: FloorCheckData; onRetry: () => void }) {
  const router = useRouter();
  const { profile, facility, timeZone } = useFloorSession();
  const now = useFloorNow();
  const ids = { how: useId(), where: useId(), doing: useId(), chips: useId(), help: useId(), wrong: useId(), late: useId() };
  const [draft, setDraft] = useState<FloorCheckDraft>(emptyFloorCheckDraft);
  const [needsClaim, setNeedsClaim] = useState(Boolean(data.task.requires_claim));
  const [serverWantsReason, setServerWantsReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt] = useState(() => ({ requestId: crypto.randomUUID(), observedAt: new Date().toISOString() }));

  const timing = useMemo(() => checkTiming(data.task.derived_status, data.task.due_at, now ?? new Date()), [data.task, now]);
  const lateReasonRequired = timing.kind === "over" || serverWantsReason;
  const pronoun = residentPronoun(data.gender);
  const dueLabel = formatDisplayTime(data.task.due_at, { timeZone });
  const chartedAt = now ? formatDisplayTime(now, { timeZone }) : "";
  const set = (patch: Partial<FloorCheckDraft>) => setDraft((current) => ({ ...current, ...patch }));

  // Offline, the owner remembered at unlock lets the check reach the outbox.
  const ownerForThisUnlock = () =>
    resolveFloorRetryOwner({
      unlockId: profile.unlockId,
      organizationId: facility.organizationId,
      facilityId: facility.facilityId,
      resolve: currentRetryOwner,
    });

  async function takeCheck() {
    setBusy(true);
    setMessage(null);
    try {
      await claimFloorCheck(data.task.id, await ownerForThisUnlock());
      setNeedsClaim(false);
    } catch (error) {
      setMessage(error instanceof FloorOperatorError ? error.message : "The check could not be taken. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const gaps = floorCheckGaps(draft, { lateReasonRequired });
    if (gaps.length > 0) return setMessage(gaps.join(" "));
    setBusy(true);
    setMessage(null);
    let owner;
    try {
      owner = await ownerForThisUnlock();
    } catch (error) {
      setBusy(false);
      return setMessage(error instanceof FloorOperatorError ? error.message : "Your sign-in could not be confirmed. Tap Switch and unlock again.");
    }
    const result = await saveFloorCheck({
      taskId: data.task.id,
      residentId: data.residentId,
      draft: buildFloorCompletionPayload(draft, data.vocab),
      owner,
      requestId: attempt.requestId,
      observedAt: attempt.observedAt,
    });
    if (result.status === "saved" || result.status === "queued") {
      // Saved: the lists must show it charted. Queued: keep what they hold, so
      // Now still reads offline; the outbox already hides the queued check.
      if (result.status === "saved") {
        dropFloorCache("tasks:");
        dropFloorCache("activity:");
        dropFloorCache(`check:${data.task.id}`);
      }
      // Back returns from the router's own cache, so it also works with the
      // Wi-Fi down; a fresh push would need the server.
      if (window.history.length > 1) router.back();
      else router.push("/floor");
      return;
    }
    setBusy(false);
    if (result.status === "reason_required") setServerWantsReason(true);
    setMessage(result.message);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FloorScreenHeader
        back={{ href: "/floor", label: "Back to Now" }}
        title={`${FLOOR_CHECK_NAME} · ${data.residentName}`}
        subtitle={
          <>
            <span className="tabular-nums">{!data.roomKnown ? "Room could not load" : data.room ? `Rm ${data.room}` : "No room posted"}</span> · due <span className="tabular-nums">{dueLabel}</span>
          </>
        }
        right={
          <StatusPill tone={timing.tone} className="h-6 rounded-[5px] px-2.5 text-xs tabular-nums">
            {timing.label}
          </StatusPill>
        }
      />
      {needsClaim ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-chrome-secondary px-6 py-3">
          <p className="text-sm text-foreground">This check is assigned to someone else. Take it to chart it; they stay on its history.</p>
          <button type="button" onClick={() => void takeCheck()} disabled={busy} className={cn(FLOOR_PRIMARY_BUTTON, "h-11 px-4 text-sm")}>
            Take this check
          </button>
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 content-start gap-x-10 gap-y-5.5 overflow-y-auto px-6 py-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5.5">
          <ChoiceGroup id={ids.how} title={checkQuestion("how", pronoun)} hint="pick one">
            {FLOOR_QUICK_STATUS_OPTIONS.map((option) => (
              <ChoiceChip key={option.value} pressed={draft.quickStatus === option.value} disabled={needsClaim} onPress={() => set({ quickStatus: draft.quickStatus === option.value ? null : option.value })}>
                {option.label}
              </ChoiceChip>
            ))}
          </ChoiceGroup>
          <ChoiceGroup id={ids.where} title={checkQuestion("where", pronoun)} hint="pick one">
            <VocabChips
              options={data.vocab.location}
              failed={data.vocabFailed}
              failedText="The places could not load."
              emptyText="No places are set up for this building yet. Tell the administrator."
              isPressed={(code) => draft.location === code}
              disabled={needsClaim}
              onPress={(code) => set({ location: draft.location === code ? null : code })}
              onRetry={onRetry}
            />
          </ChoiceGroup>
          <ChoiceGroup id={ids.doing} title={checkQuestion("doing", pronoun)} hint="pick one">
            <VocabChips
              options={data.vocab.state}
              failed={data.vocabFailed}
              failedText="The choices could not load."
              emptyText="Nothing is set up for this building yet. Tell the administrator."
              isPressed={(code) => draft.residentState === code}
              disabled={needsClaim}
              onPress={(code) => set({ residentState: draft.residentState === code ? null : code })}
              onRetry={onRetry}
            />
          </ChoiceGroup>
        </div>
        <div className="flex flex-col gap-5.5">
          <div className="flex flex-col gap-4" role="group" aria-labelledby={ids.chips}>
            <p id={ids.chips} className="text-[13px] text-muted-foreground">
              Pick at least one for meals, mood or medications.
            </p>
            {OBSERVATION_CHIP_GROUPS.map((group) => (
              <ChoiceGroup key={group} id={`${ids.chips}-${group}`} title={OBSERVATION_CHIP_GROUP_HEADINGS[group]} hint="any">
                <VocabChips
                  options={data.vocab[group]}
                  failed={data.vocabFailed}
                  failedText="The choices could not load."
                  emptyText="Nothing is set up for this building yet."
                  isPressed={(code) => isObservationChipSelected(draft.chips, group, code)}
                  disabled={needsClaim}
                  onPress={(code) => set({ chips: toggleObservationChip(draft.chips, group, code) })}
                  onRetry={onRetry}
                />
              </ChoiceGroup>
            ))}
          </div>
          <ChoiceGroup id={ids.help} title="Did you help with" hint="any">
            {FLOOR_HELPED_WITH_OPTIONS.map((option) => (
              <ChoiceChip key={option.value} pressed={draft.helpedWith.includes(option.value)} disabled={needsClaim} onPress={() => set({ helpedWith: toggleValue(draft.helpedWith, option.value) })}>
                {option.label}
              </ChoiceChip>
            ))}
          </ChoiceGroup>
          <ChoiceGroup id={ids.wrong} title="Anything wrong?" hint="any">
            {FLOOR_ANYTHING_WRONG_OPTIONS.map((option) => (
              <ChoiceChip key={option.value} pressed={draft.anythingWrong.includes(option.value)} disabled={needsClaim} onPress={() => set({ anythingWrong: toggleValue(draft.anythingWrong, option.value) })}>
                {option.label}
              </ChoiceChip>
            ))}
          </ChoiceGroup>
          <div className="flex flex-col gap-2">
            <label htmlFor={ids.late} className="text-[15px] font-semibold text-foreground">
              Why late? <span className="font-normal text-muted-foreground">needed when a check is over</span>
            </label>
            <input
              id={ids.late}
              value={draft.lateReason}
              onChange={(event) => set({ lateReason: event.target.value.slice(0, 500) })}
              disabled={needsClaim}
              required={lateReasonRequired}
              aria-required={lateReasonRequired}
              placeholder="With another resident, for example"
              autoComplete="off"
              className={cn("h-13 rounded-[8px] border border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground", FLOOR_FOCUS_RING)}
            />
          </div>
        </div>
      </div>
      <div className="flex min-h-19 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-chrome-secondary px-6 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-muted-foreground">
            Charted by {profile.displayName} at <span className="tabular-nums">{chartedAt}</span> · saves offline if Wi-Fi drops
          </span>
          <p role="status" aria-live="polite" className={cn("text-[13px] font-medium text-destructive", !message && "sr-only")}>
            {message ?? ""}
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/floor" className={cn(FLOOR_OUTLINE_BUTTON, "h-13 rounded-[10px] px-5.5 text-base font-medium")}>
            Cancel
          </Link>
          <button type="button" onClick={() => void save()} disabled={busy || needsClaim} className={cn(FLOOR_PRIMARY_BUTTON, "h-13 rounded-[10px] px-7 text-base")}>
            <Check className="size-4.5" aria-hidden />
            {busy ? "Saving" : "Save check"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One vocabulary row of chips, or why there are none: a failed read says so, never "none set up". */
function VocabChips({
  options,
  failed,
  failedText,
  emptyText,
  isPressed,
  disabled,
  onPress,
  onRetry,
}: {
  options: readonly ObservationVocabOption[];
  failed: boolean;
  failedText: string;
  emptyText: string;
  isPressed: (code: string) => boolean;
  disabled: boolean;
  onPress: (code: string) => void;
  onRetry: () => void;
}) {
  if (failed) return <StatusReadError text={failedText} onRetry={onRetry} />;
  if (options.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <>
      {options.map((option) => (
        <ChoiceChip key={option.code} pressed={isPressed(option.code)} disabled={disabled} onPress={() => onPress(option.code)}>
          {option.label}
        </ChoiceChip>
      ))}
    </>
  );
}
