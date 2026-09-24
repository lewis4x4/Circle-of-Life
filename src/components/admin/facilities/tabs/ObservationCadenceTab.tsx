"use client";

/**
 * Cadence and escalation settings. Spec 25A section 6.
 *
 * This lives in facility administration and not in the Smart Rounding tab
 * strip, which stays at five tabs. Changing the observation schedule is
 * building configuration; the strip is where the floor works.
 *
 * Three tiers, in the order spec 6.13 gives them. Tier 1 is the 24 hour strip,
 * the ladder in wall clock terms, the template name or Custom and the effective
 * from date. Tier 2 is editing one check or one step. Tier 3 is the version
 * history, the change log with reasons, and rollback. The preview and the
 * simulate action sit between tier 2 and the commit, which is where spec 6.6
 * puts them.
 *
 * Nothing in this file is an observation time, a grace value, an escalation
 * offset, a recipient, a channel, a shift boundary, a threshold or a lookback
 * span. All of it arrives as rows through `observation_config_overview`.
 */

import { formatDisplayDateTime } from "@/lib/format/datetime";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { CadencePolicyDiff } from "@/components/rounding/CadencePolicyDiff";
import { CadenceTemplatePortfolio } from "@/components/rounding/CadenceTemplatePortfolio";
import { CadenceConfigurationEditor } from "@/components/rounding/CadenceConfigurationEditor";
import { CadenceCurrentSummary } from "@/components/rounding/CadenceCurrentSummary";
import { CadenceEditorSection } from "@/components/rounding/CadenceEditorSection";
import { CadencePreviewPanel } from "@/components/rounding/CadencePreviewPanel";
import { CadenceVersionHistory } from "@/components/rounding/CadenceVersionHistory";
import { RoundingEmptyNotice, RoundingErrorNotice } from "@/components/rounding/RoundingNotices";
import { Button } from "@/components/ui/button";
import { useObservationCadenceSettings } from "@/hooks/useObservationCadenceSettings";
import {
  CADENCE_SETTINGS_EMPTY,
  CADENCE_SETTINGS_SUBTITLE,
  templateLine,
} from "@/lib/rounding/cadence-settings-copy";
import { shiftsFromConfiguration, type WindowDraft, type RungDraft } from "@/lib/rounding/cadence-settings";
import { cn } from "@/lib/utils";

export function ObservationCadenceTab({ facilityId }: { facilityId: string }) {
  const settings = useObservationCadenceSettings(facilityId);
  const [configurationValid, setConfigurationValid] = useState(true);
  const [openWindowKey, setOpenWindowKey] = useState<string | null>(null);
  const [openRungKey, setOpenRungKey] = useState<string | null>(null);

  const { overview, proposal, busy, loadState } = settings;

  if (loadState === "loading" && overview == null) {
    return (
      <RoundingEmptyNotice
        label="Loading the observation schedule"
        copy={{
          why: "Loading this building's schedule.",
          guidance: "The checks and the ladder are on their way.",
        }}
      />
    );
  }

  if (overview == null) {
    return (
      <div className="space-y-4">
        {settings.errorMessage ? (
          <RoundingErrorNotice message={settings.errorMessage} onRetry={() => void settings.reload(null)} />
        ) : null}
        <RoundingEmptyNotice label="Observation schedule" copy={CADENCE_SETTINGS_EMPTY} />
      </div>
    );
  }

  function discard() {
    settings.resetDrafts();
    setOpenWindowKey(null);
    setOpenRungKey(null);
    void settings.reload(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] leading-relaxed text-muted-foreground">{CADENCE_SETTINGS_SUBTITLE}</p>
          <p className="text-[13px] text-foreground">{templateLine(overview.cadence_template_name)}</p>
          {overview.current.cadence_effective_from ? (
            <p className="text-[13px] tabular-nums text-muted-foreground">
              In force since {formatDisplayDateTime(overview.current.cadence_effective_from)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void settings.reload(proposal)}
          aria-label="Refresh the observation schedule"
          title="Refresh"
          disabled={loadState === "loading"}
        >
          <RefreshCw className={cn("size-4", loadState === "loading" && "animate-spin")} aria-hidden />
        </Button>
      </div>

      {settings.errorMessage ? (
        <RoundingErrorNotice message={settings.errorMessage} onRetry={() => void settings.reload(proposal)} />
      ) : null}
      {settings.notice ? (
        <div role="status" className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[13px] leading-relaxed text-foreground">{settings.notice}</p>
        </div>
      ) : null}

      <CadenceCurrentSummary
        overview={overview}
        onEditRung={(rungKey) => {
          setOpenRungKey(openRungKey === rungKey ? null : rungKey);
          setOpenWindowKey(null);
        }}
        onTestSend={(rungKey) => void settings.testSend(rungKey)}
        testSendBusyRungKey={settings.testSendRungKey}
      />

      {overview.pending_proposals?.length ? <section aria-label="Saved proposals" className="space-y-2">
        <h2 className="text-sm font-semibold">Proposals awaiting approval</h2>
        {overview.pending_proposals.map((pending) => <div key={pending.proposal_id} className="rounded border border-border p-3 text-sm">
          <p>{pending.change_reason} — {pending.created_by_name ?? "Recorded administrator"}, {formatDisplayDateTime(pending.created_at)}</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void settings.reopenProposal({ cadenceVersionId: pending.cadence_version_id, escalationVersionId: pending.escalation_version_id })}>Review saved proposal</Button>
        </div>)}
      </section> : null}
      {settings.configurationDraft && <CadenceConfigurationEditor value={settings.configurationDraft} severityClasses={overview.available_severity_classes} rosterShiftTypes={overview.roster_shift_types} onChange={settings.setConfigurationDraft} onValidityChange={setConfigurationValid} disabled={busy || proposal != null} />}
      <CadenceEditorSection
        overview={{ ...overview, shifts: settings.configurationDraft ? shiftsFromConfiguration(settings.configurationDraft) : overview.shifts }}
        windowDrafts={settings.windowDrafts}
        rungDrafts={settings.rungDrafts}
        openWindowKey={openWindowKey}
        openRungKey={openRungKey}
        onOpenWindow={(windowKey) => {
          setOpenWindowKey(openWindowKey === windowKey ? null : windowKey);
          setOpenRungKey(null);
        }}
        onAddWindow={() => {
          const source = settings.windowDrafts[0];
          if (!source) return;
          const next = { ...source, window_key: `window_${crypto.randomUUID().replaceAll("-", "_")}`, label: "New observation window", enabled: false, sort_order: settings.windowDrafts.length };
          settings.setWindowDrafts((rows) => [...rows, next]);
          setOpenWindowKey(next.window_key);
        }}
        onWindowChange={(next, previousKey) => {
          settings.setWindowDrafts((drafts) => drafts.map((candidate) => candidate.window_key === previousKey ? next : candidate));
          setOpenWindowKey(next.window_key);
        }}
        onRungChange={(next, previousKey) => {
          settings.setRungDrafts((drafts) => drafts.map((candidate) => candidate.rung_key === previousKey ? next : candidate));
          setOpenRungKey(next.rung_key);
        }}
        reason={settings.proposalReason}
        onReasonChange={settings.setProposalReason}
        onPropose={() => void settings.propose()}
        onDiscard={discard}
        invalid={!configurationValid}
        showReason={settings.dirty && proposal == null}
        locked={proposal != null}
        busy={busy}
      />

      {proposal && overview.proposed?.configuration && <section aria-label="Proposed facility policy changes" className="space-y-3">
        <h2 className="text-sm font-semibold">Facility policy changes in this proposal</h2>
        <CadencePolicyDiff before={overview.configuration ? [overview.configuration] : []} after={[overview.proposed.configuration]} />
      </section>}
      {proposal ? (
        <CadencePreviewPanel
          overview={overview}
          simulation={settings.simulation}
          activationReason={settings.activationReason}
          onActivationReasonChange={settings.setActivationReason}
          applyMode={settings.applyMode}
          onApplyModeChange={settings.setApplyMode}
          scheduledFor={settings.scheduledFor}
          onScheduledForChange={settings.setScheduledFor}
          acknowledgment={settings.acknowledgment}
          onAcknowledgmentChange={settings.setAcknowledgment}
          onSimulate={() => void settings.simulate()}
          onCommit={() => void settings.commit()}
          onDiscard={discard}
          busy={busy}
        />
      ) : null}

      <CadenceTemplatePortfolio key={facilityId} facilityId={facilityId} windows={settings.windowDrafts} rungs={settings.rungDrafts} onEditTemplate={(kind, rows) => { if (kind === "cadence") { settings.setWindowDrafts(rows as WindowDraft[]); setOpenWindowKey((rows as WindowDraft[])[0]?.window_key ?? null); } else { settings.setRungDrafts(rows as RungDraft[]); setOpenRungKey((rows as RungDraft[])[0]?.rung_key ?? null); } }} />

      <CadenceVersionHistory
        entries={settings.changeLog}
        onRollback={(entry) => void settings.rollback(entry)}
        canRollback={proposal == null}
        busy={busy}
      />
    </div>
  );
}
