"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, Mic, Send, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { usePathname } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { graceOrchestrate } from "./api";
import { pushGracePresence } from "./presence";
import { useGraceStore } from "./store";
import { filterGraceTemplates } from "./templates";
import { useGraceKnowledgeStream } from "./useGraceKnowledgeStream";
import { graceSpeak, cancelGraceSpeech } from "./voice/tts";
import {
  transcribeGraceAudio,
  useGraceVoiceRecorder,
} from "./voice/useGraceVoiceRecorder";
import type { GraceChatMessage, GraceKnowledgeSource, GraceTemplate } from "./types";

const FACILITY_NAME_PLACEHOLDER = "the facility selected in the header";

function applyTemplatePhrase(
  phrase: string,
  facilityName: string | null
): string {
  const name = facilityName?.trim() || FACILITY_NAME_PLACEHOLDER;
  return phrase.replace(/\{facilityName\}/g, name);
}

function graceContextPrefix(
  facility: { id: string; name: string } | null
): string {
  if (!facility) {
    return `[Context: No facility is selected in the header. Use org-wide accessible data. When the user names a specific site (for example Oakridge), resolve it with census and facility tools.]\n\n`;
  }
  return `[Context: Header facility focus is "${facility.name}". Use it for "this facility" or "here". The user may still ask about other sites by name—resolve accurately with tools.]\n\n`;
}

function resolveTemplateAction(
  template: GraceTemplate
): "focus_only" | "send_knowledge" | "route_flow" {
  if (template.action) return template.action;
  if (template.flow_slug) return "route_flow";
  return "send_knowledge";
}

interface SendOptions {
  mode?: "text" | "voice";
  /** Structured flows only — runs grace-orchestrator first. Default: knowledge-agent directly (lower latency). */
  routeFlows?: boolean;
}

function sourceKey(source: GraceKnowledgeSource): string {
  return `${source.title}-${source.section_title ?? ""}-${source.confidence}`;
}

const KNOWLEDGE_THINKING_STEPS = [
  {
    label: "Verifying your access",
    hint: "Checking role, organization, and selected facility context.",
  },
  {
    label: "Sweeping live operations",
    hint: "Looking through census, incidents, meds, and operational records.",
  },
  {
    label: "Searching policy memory",
    hint: "Pulling uploaded documents and knowledge-base evidence.",
  },
  {
    label: "Composing Grace's answer",
    hint: "Merging live signals into a single operator-facing response.",
  },
] as const;

const FLOW_THINKING_STEPS = [
  {
    label: "Reading your intent",
    hint: "Classifying whether this should answer directly or trigger a flow.",
  },
  {
    label: "Selecting the lane",
    hint: "Choosing the lowest-latency route that preserves auditability.",
  },
  {
    label: "Preparing Grace",
    hint: "Opening the right conversation and preloading context.",
  },
] as const;

type GraceThinkingMode = "knowledge" | "flow";

function GraceThinkingPanel({
  mode,
  facilityName,
  elapsedMs,
  sourceCount,
  sourceTitles,
}: {
  mode: GraceThinkingMode;
  facilityName: string | null;
  elapsedMs: number;
  sourceCount: number;
  sourceTitles: string[];
}) {
  const steps =
    mode === "flow" ? FLOW_THINKING_STEPS : KNOWLEDGE_THINKING_STEPS;
  const stageIndex = Math.min(
    steps.length - 1,
    Math.floor(elapsedMs / (mode === "flow" ? 1800 : 2600))
  );
  const seconds = Math.max(1, Math.floor(elapsedMs / 1000));
  const laneStates =
    mode === "flow"
      ? [
          {
            label: "Intent lane",
            value: stageIndex >= 0 ? "locked" : "warming",
            tone:
              stageIndex >= 1
                ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"
                : "border-violet-300/20 bg-violet-400/10 text-violet-50",
          },
          {
            label: "Risk lane",
            value: stageIndex >= 1 ? "scored" : "waiting",
            tone:
              stageIndex >= 2
                ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"
                : "border-white/10 bg-white/[0.04] text-white/70",
          },
          {
            label: "Flow lane",
            value: stageIndex >= 2 ? "primed" : "holding",
            tone:
              stageIndex >= 2
                ? "border-violet-300/25 bg-violet-400/12 text-violet-50"
                : "border-white/10 bg-white/[0.04] text-white/70",
          },
        ]
      : [
          {
            label: "Auth lane",
            value: stageIndex >= 0 ? "verified" : "warming",
            tone:
              stageIndex >= 1
                ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"
                : "border-violet-300/20 bg-violet-400/10 text-violet-50",
          },
          {
            label: "Live data",
            value: stageIndex >= 1 ? "querying" : "waiting",
            tone:
              stageIndex >= 2
                ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-50"
                : "border-white/10 bg-white/[0.04] text-white/70",
          },
          {
            label: "Knowledge",
            value:
              sourceCount > 0
                ? `${sourceCount} sources`
                : stageIndex >= 2
                  ? "scanning"
                  : "cold",
            tone:
              sourceCount > 0
                ? "border-fuchsia-300/25 bg-fuchsia-400/12 text-fuchsia-50"
                : "border-white/10 bg-white/[0.04] text-white/70",
          },
        ];
  const longWait = seconds >= 8;
  const pulseCount = 10;

  return (
    <div className="overflow-hidden rounded-[1.3rem] border border-violet-400/20 bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.14),rgba(15,23,42,0.94)_42%,rgba(2,6,23,0.97))] shadow-[0_0_0_1px_rgba(139,92,246,0.08),0_16px_60px_rgba(76,29,149,0.28)]">
      <div className="border-b border-violet-400/15 bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-8 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/10">
              <span className="absolute inset-0 rounded-xl bg-violet-400/10 animate-pulse" />
              <Sparkles className="relative size-3.5 text-violet-300" />
            </span>
            <div>
              <div className="text-[13px] font-semibold tracking-tight text-white">
                {mode === "flow" ? "Grace is choosing a path" : "Grace is reading the system"}
              </div>
              <div className="text-[11px] text-violet-100/65">
                {facilityName
                  ? `Focused on ${facilityName}`
                  : "Running org-wide until a header facility is selected"}
              </div>
            </div>
          </div>
          <div className="rounded-full border border-violet-300/15 bg-black/20 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-violet-100/70">
            {seconds}s live
          </div>
        </div>
      </div>

      <div className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1.1fr)_220px]">
        <div className="space-y-2.5">
          {steps.map((step, index) => {
            const complete = index < stageIndex;
            const active = index === stageIndex;
            return (
              <div
                key={step.label}
                className={`relative overflow-hidden rounded-xl border px-3 py-2.5 transition-all duration-500 ${
                  active
                    ? "border-violet-300/35 bg-violet-500/10 shadow-[0_0_24px_rgba(139,92,246,0.18)]"
                    : complete
                      ? "border-emerald-300/20 bg-emerald-500/10"
                      : "border-white/8 bg-white/[0.02]"
                }`}
              >
                {active ? (
                  <div className="pointer-events-none absolute inset-0 translate-x-[-100%] animate-[grace-scan_1.8s_linear_infinite] bg-gradient-to-r from-transparent via-violet-300/12 to-transparent" />
                ) : null}
                <div className="relative flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                      complete
                        ? "bg-emerald-400/20 text-emerald-100"
                        : active
                          ? "bg-violet-300/20 text-violet-50"
                          : "bg-white/8 text-white/45"
                    }`}
                  >
                    {complete ? "✓" : index + 1}
                  </span>
                  <div className="min-w-0">
                    <div
                      className={`text-[13px] font-medium ${
                        active || complete ? "text-white" : "text-white/60"
                      }`}
                    >
                      {step.label}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-white/55">
                      {step.hint}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="relative overflow-hidden rounded-[1.3rem] border border-white/8 bg-black/25 p-3">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(129,140,248,0.2),transparent_45%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.18),transparent_35%)]" />
          <div className="relative space-y-3">
            <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-violet-100/55">
              Grace core
            </div>
            <div className="relative flex min-h-[116px] items-center justify-center overflow-hidden rounded-[1.1rem] border border-violet-300/10 bg-[radial-gradient(circle_at_center,rgba(76,29,149,0.28),transparent_55%)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.12),transparent_40%)]" />
              <div className="relative flex size-20 items-center justify-center">
                <div className="absolute size-20 rounded-full border border-violet-300/20 animate-[grace-orbit_12s_linear_infinite]" />
                <div className="absolute size-14 rounded-full border border-cyan-300/20 animate-[grace-orbit_8s_linear_infinite_reverse]" />
                <div className="absolute size-9 rounded-full bg-[radial-gradient(circle_at_top,rgba(192,132,252,0.95),rgba(91,33,182,0.72)_45%,rgba(14,116,144,0.58)_100%)] shadow-[0_0_28px_rgba(168,85,247,0.45)] animate-[grace-breathe_2.6s_ease-in-out_infinite]" />
                {Array.from({ length: pulseCount }).map((_, index) => {
                  const angle = (index / pulseCount) * Math.PI * 2;
                  const x = Math.cos(angle) * 50;
                  const y = Math.sin(angle) * 50;
                  return (
                    <span
                      key={index}
                      className="absolute size-1.5 rounded-full bg-violet-200/65"
                      style={{
                        transform: `translate(${x}px, ${y}px)`,
                        animation: `grace-node 1.6s ${index * 110}ms ease-in-out infinite`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="grid gap-1.5">
              {laneStates.map((lane) => (
                <div
                  key={lane.label}
                  className={`flex items-center justify-between rounded-xl border px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-[0.14em] ${lane.tone}`}
                >
                  <span>{lane.label}</span>
                  <span>{lane.value}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-violet-300/10 bg-white/[0.03] p-2.5 text-[12px] leading-relaxed text-white/75">
              {mode === "flow"
                ? "Routing the request before Grace speaks keeps higher-risk actions auditable."
                : "Grace is live against operational data and uploaded policies. Long answers can take a few more seconds while evidence is gathered."}
            </div>
            {sourceCount > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-fuchsia-100/60">
                  Evidence arriving
                </div>
                <div className="flex flex-wrap gap-2">
                  {sourceTitles.slice(0, 4).map((title, index) => (
                    <span
                      key={`${title}-${index}`}
                      className="rounded-full border border-fuchsia-300/20 bg-fuchsia-400/10 px-2 py-0.5 text-[10px] text-fuchsia-50/90"
                    >
                      {title}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.16em] text-white/45">
                <span>Signal build</span>
                <span>{Math.min(96, 24 + stageIndex * 24)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-cyan-300 transition-all duration-700"
                  style={{ width: `${Math.min(96, 24 + stageIndex * 24)}%` }}
                />
              </div>
            </div>
            {longWait ? (
              <div className="rounded-xl border border-amber-300/15 bg-amber-300/8 px-2.5 py-2 text-[11px] leading-relaxed text-amber-50/85">
                Deep queries can take longer when Grace is merging live operations with policy evidence. She is still working.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GraceBar() {
  const {
    state,
    openBar,
    closeBar,
    startFlow,
    setError,
    setNarrationEnabled,
    setLastInputMode,
    chatAppend,
    chatPatchLast,
    setConversationId,
  } = useGraceStore();
  const { appRole, organizationId } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);

  const selectedFacility = useMemo(() => {
    if (!selectedFacilityId) return null;
    return availableFacilities.find((f) => f.id === selectedFacilityId) ?? null;
  }, [availableFacilities, selectedFacilityId]);

  const [input, setInput] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const [busyNow, setBusyNow] = useState<number>(() => Date.now());
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastNarratedTextRef = useRef("");

  const knowledge = useGraceKnowledgeStream();
  const recorder = useGraceVoiceRecorder();

  const templates = useMemo(() => filterGraceTemplates(appRole), [appRole]);

  const augmentMessageForGrace = useCallback(
    (message: string) => graceContextPrefix(selectedFacility) + message,
    [selectedFacility]
  );

  const knowledgeStart = knowledge.start;
  const knowledgeCancel = knowledge.cancel;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? event.metaKey : event.ctrlKey;
      if (cmd && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (state.barOpen) closeBar();
        else openBar();
      } else if (event.key === "Escape" && state.barOpen) {
        closeBar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeBar, openBar, state.barOpen]);

  useEffect(() => {
    if (state.barOpen) {
      const timer = window.setTimeout(() => textareaRef.current?.focus(), 50);
      return () => window.clearTimeout(timer);
    }
    setInput("");
    setClassifying(false);
    return undefined;
  }, [state.barOpen]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [knowledge.status, knowledge.text, state.chatMessages]);

  useEffect(() => {
    if (knowledge.status === "streaming" || knowledge.status === "done") {
      const emptyDone =
        knowledge.status === "done" && !knowledge.text.trim();
      chatPatchLast({
        content: emptyDone
          ? "Grace returned no text. Try again or rephrase. If this persists, confirm your profile has an organization and you have access to the facility you asked about."
          : knowledge.text,
        pending: knowledge.status !== "done",
        citations: knowledge.sources,
      });
    }
    if (knowledge.status === "done" && knowledge.meta?.conversation_id) {
      setConversationId(knowledge.meta.conversation_id);
    }
    if (knowledge.status === "error" && knowledge.error) {
      chatPatchLast({
        content: `Grace hit an error: ${knowledge.error}`,
        pending: false,
      });
    }
  }, [
    chatPatchLast,
    knowledge.error,
    knowledge.meta,
    knowledge.sources,
    knowledge.status,
    knowledge.text,
    setConversationId,
  ]);

  useEffect(() => {
    if (
      knowledge.status === "done" &&
      state.narrationEnabled &&
      knowledge.text.trim().length > 0 &&
      knowledge.text !== lastNarratedTextRef.current
    ) {
      lastNarratedTextRef.current = knowledge.text;
      void graceSpeak(knowledge.text).catch(() => {
        // Non-blocking narration failure.
      });
    }
  }, [knowledge.status, knowledge.text, state.narrationEnabled]);

  const appendAssistantPlaceholder = useCallback(() => {
    const placeholder: GraceChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      pending: true,
      createdAt: Date.now(),
    };
    chatAppend(placeholder);
  }, [chatAppend]);

  const streamKnowledge = useCallback(
    async (message: string) => {
      if (!organizationId) {
        throw new Error(
          "Grace needs an organization context before it can answer."
        );
      }
      appendAssistantPlaceholder();
      await knowledgeStart({
        message,
        conversationId: state.conversationId ?? undefined,
        organizationId,
        route: pathname,
      });
    },
    [
      appendAssistantPlaceholder,
      knowledgeStart,
      organizationId,
      pathname,
      state.conversationId,
    ]
  );

  const send = useCallback(
    async (explicitText?: string, options: SendOptions = {}) => {
      const message = (explicitText ?? input).trim();
      if (
        !message ||
        classifying ||
        knowledge.status === "streaming" ||
        knowledge.status === "connecting"
      ) {
        return;
      }
      if (!organizationId) {
        setError(
          "Grace needs an organization on your profile before it can access data."
        );
        return;
      }
      cancelGraceSpeech();
      setInput("");
      setError(null);
      setLastInputMode(options.mode ?? "text");
      const augmented = augmentMessageForGrace(message);
      chatAppend({
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        createdAt: Date.now(),
      });

      if (!options.routeFlows) {
        try {
          await streamKnowledge(augmented);
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : "Grace request failed";
          setError(errMsg);
          chatAppend({
            id: crypto.randomUUID(),
            role: "assistant",
            content: errMsg,
            createdAt: Date.now(),
          });
          pushGracePresence("grace-error", "alert", { ttlMs: 3000 });
        }
        return;
      }

      setClassifying(true);
      const release = pushGracePresence("grace-classify", "thinking");
      try {
        const result = await graceOrchestrate({
          text: message,
          conversation_id: state.conversationId ?? undefined,
          input_mode: options.mode === "voice" ? "voice" : "text",
          route: pathname,
        });

        if (!result.ok) {
          chatAppend({
            id: crypto.randomUUID(),
            role: "assistant",
            content: result.message ?? "Grace could not route that request.",
            createdAt: Date.now(),
          });
          return;
        }

        const classification = result.classification;
        if (!classification) {
          await streamKnowledge(augmented);
          return;
        }

        if (
          classification.category === "FLOW_DISPATCH" &&
          result.flow_definition &&
          result.conversation_id
        ) {
          startFlow({
            flow: result.flow_definition,
            conversationId: result.conversation_id,
            prefilled: classification.prefilled_slots ?? {},
          });
          chatAppend({
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Starting ${result.flow_definition.name}...`,
            createdAt: Date.now(),
          });
          return;
        }

        if (classification.category === "HUMAN_ESCALATION") {
          pushGracePresence("grace-escalation", "alert", { ttlMs: 4000 });
        }

        if (result.conversation_id) {
          setConversationId(result.conversation_id);
        }
        await streamKnowledge(augmented);
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "Grace request failed";
        setError(errMsg);
        chatAppend({
          id: crypto.randomUUID(),
          role: "assistant",
          content: errMsg,
          createdAt: Date.now(),
        });
        pushGracePresence("grace-error", "alert", { ttlMs: 3000 });
      } finally {
        release();
        setClassifying(false);
      }
    },
    [
      augmentMessageForGrace,
      chatAppend,
      classifying,
      input,
      knowledge.status,
      organizationId,
      pathname,
      setConversationId,
      setError,
      setLastInputMode,
      startFlow,
      state.conversationId,
      streamKnowledge,
    ]
  );

  const handleTemplateClick = useCallback(
    async (template: GraceTemplate) => {
      const action = resolveTemplateAction(template);
      if (action === "focus_only") {
        window.setTimeout(() => textareaRef.current?.focus(), 0);
        return;
      }
      const phrase = applyTemplatePhrase(
        template.phrase,
        selectedFacility?.name ?? null
      ).trim();
      if (!phrase) return;

      if (action === "route_flow") {
        await send(phrase, { routeFlows: true });
        return;
      }
      await send(phrase);
    },
    [send, selectedFacility?.name]
  );

  const graceBusy =
    classifying ||
    knowledge.status === "streaming" ||
    knowledge.status === "connecting";
  const busySince = useRef<number | null>(null);

  useEffect(() => {
    if (graceBusy && busySince.current == null) {
      busySince.current = Date.now();
      setBusyNow(Date.now());
      return;
    }
    if (!graceBusy) {
      busySince.current = null;
      setBusyNow(Date.now());
    }
  }, [graceBusy]);

  useEffect(() => {
    if (!graceBusy) return;
    const interval = window.setInterval(() => {
      setBusyNow(Date.now());
    }, 700);
    return () => window.clearInterval(interval);
  }, [graceBusy]);

  const thinkingElapsedMs = Math.max(
    0,
    busySince.current ? busyNow - busySince.current : 0
  );
  const liveSourceTitles = useMemo(
    () =>
      Array.from(
        new Set(
          knowledge.sources
            .map((source) => source.title.trim())
            .filter((title) => title.length > 0)
        )
      ),
    [knowledge.sources]
  );

  const toggleVoiceCapture = useCallback(async () => {
    if (!recorder.supported) {
      setError("Voice capture is not supported in this browser.");
      return;
    }
    if (recorder.recording) {
      setVoicePending(true);
      try {
        const audio = await recorder.stop();
        if (!audio) return;
        const transcript = await transcribeGraceAudio(audio);
        setInput(transcript);
        await send(transcript, { mode: "voice" });
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Voice transcription failed"
        );
      } finally {
        setVoicePending(false);
      }
      return;
    }
    const started = await recorder.start();
    if (!started) {
      setError(recorder.error ?? "Microphone access failed");
    }
  }, [recorder, send, setError]);

  return (
    <Dialog open={state.barOpen} onOpenChange={(open) => !open && closeBar()}>
      <DialogContent className="flex h-[min(88vh,780px)] max-w-5xl flex-col overflow-hidden border border-violet-500/20 bg-gradient-to-b from-violet-950/25 via-background to-background p-0 shadow-2xl shadow-violet-950/40 backdrop-blur-xl dark:from-violet-950/40 dark:via-background dark:to-background">
        <DialogHeader className="border-b border-violet-500/10 bg-violet-500/[0.03] px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg tracking-tight">
                <span className="flex size-8 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-400/30">
                  <Sparkles className="size-4 text-violet-400" />
                </span>
                Grace
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-xl text-pretty">
                Answers from live operational data and uploaded policies. Pick a
                quick question or type your own.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                className={state.narrationEnabled ? "animate-on-click" : ""}
                onClick={() => {
                  if (state.narrationEnabled) cancelGraceSpeech();
                  setNarrationEnabled(!state.narrationEnabled);
                }}
                title={
                  state.narrationEnabled
                    ? "Disable narration"
                    : "Enable narration"
                }
                aria-label={
                  state.narrationEnabled
                    ? "Disable narration"
                    : "Enable narration"
                }
              >
                {state.narrationEnabled ? (
                  <Volume2 className="size-4" />
                ) : (
                  <VolumeX className="size-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  knowledgeCancel();
                  cancelGraceSpeech();
                  // Add visual feedback for button click
                  const btn = document.querySelector(
                    '[aria-label="Stop response"]'
                  ) as HTMLButtonElement;
                  if (btn) btn.style.transform = "scale(0.95)";
                  setTimeout(() => (btn.style.transform = ""), 150);
                }}
                title="Stop response"
                aria-label="Stop response"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[288px_minmax(0,1fr)]">
          <aside className="border-r border-violet-500/10 bg-muted/15 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Quick questions
            </div>
            {selectedFacility ? (
              <p className="mb-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                Facility focus:{" "}
                <span className="font-medium text-foreground">
                  {selectedFacility.name}
                </span>
              </p>
            ) : (
              <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-100/90">
                No facility in header—answers default to org-wide. Select a site
                for tighter context.
              </p>
            )}
            <div className="grid max-h-[min(52vh,420px)] gap-2 overflow-y-auto pr-1">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  disabled={graceBusy}
                  onClick={() => void handleTemplateClick(template)}
                  className="rounded-2xl border border-border/80 bg-background/80 px-3.5 py-3 text-left shadow-sm transition hover:border-violet-400/50 hover:bg-violet-500/[0.07] disabled:pointer-events-none disabled:opacity-45 dark:border-white/10 dark:bg-background/40 dark:hover:bg-violet-500/10"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 ring-1 ring-violet-400/25">
                      <template.icon className="size-4 text-violet-500 dark:text-violet-400" />
                    </span>
                    <div className="text-sm font-semibold leading-tight">
                      {template.title}
                    </div>
                  </div>
                  <div className="pl-10 text-xs leading-snug text-muted-foreground">
                    {template.subtitle}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div
              ref={scrollRef}
              className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
            >
              {!organizationId ? (
                <div className="rounded-2xl border border-amber-400/40 bg-amber-50/90 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-50">
                  Your profile must have an organization assigned before Grace
                  can query live data. Contact an administrator if this message
                  persists.
                </div>
              ) : null}

              {state.errorBanner ? (
                <div className="rounded-2xl border border-rose-300/50 bg-rose-50/80 p-4 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                  {state.errorBanner}
                </div>
              ) : null}

              {state.chatMessages.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-violet-500/25 bg-violet-500/[0.04] p-8 text-center">
                  <Bot className="mx-auto mb-3 size-9 text-violet-500" />
                  <div className="text-lg font-semibold tracking-tight">
                    Start with left rail or type below
                  </div>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    Quick questions send immediately. For site-specific counts,
                    pick the right facility in app header first—or name site in
                    your message (for example Oakridge).
                  </p>
                </div>
              ) : null}

              {state.chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[min(92%,720px)] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
                    message.role === "user"
                      ? "ml-auto bg-gradient-to-br from-violet-600 to-violet-700 text-white shadow-violet-900/20"
                      : "border border-border/60 bg-card/80 text-foreground dark:border-white/10 dark:bg-muted/30"
                  }`}
                >
                  {message.pending &&
                  message.role === "assistant" &&
                  !message.content.trim() ? (
                    <GraceThinkingPanel
                      mode="knowledge"
                      facilityName={selectedFacility?.name ?? null}
                      elapsedMs={thinkingElapsedMs}
                      sourceCount={knowledge.sources.length}
                      sourceTitles={liveSourceTitles}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {message.content || (message.pending ? "…" : "")}
                    </div>
                  )}
                  {message.pending &&
                  message.role === "assistant" &&
                  message.content.trim() ? (
                    <span
                      className="mt-2 inline-block h-3 w-px animate-pulse bg-violet-500/80"
                      aria-hidden
                    />
                  ) : null}
                  {message.citations?.length ? (
                    <div className="mt-3 grid gap-2">
                      {message.citations.map((source) => (
                        <div
                          key={sourceKey(source)}
                          className="rounded-2xl border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground"
                        >
                          <div className="font-medium text-foreground">
                            {source.title}
                          </div>
                          <div className="mt-1">{source.excerpt}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}

              {classifying ? (
                <GraceThinkingPanel
                  mode="flow"
                  facilityName={selectedFacility?.name ?? null}
                  elapsedMs={thinkingElapsedMs}
                  sourceCount={knowledge.sources.length}
                  sourceTitles={liveSourceTitles}
                />
              ) : null}

              {!classifying && knowledge.status === "connecting" ? (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-violet-50/80">
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-violet-300" />
                    Grace handshake complete. Opening live search channels…
                  </div>
                </div>
              ) : null}

              {knowledge.kbEmpty ? (
                <div className="rounded-2xl border border-amber-300/40 bg-amber-50/60 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  Grace could not find matching uploaded documents. Live
                  operational tools still work, but policy answers improve once
                  materials are uploaded under `/admin/knowledge/admin`.
                </div>
              ) : null}
            </div>

            <div className="border-t border-violet-500/10 bg-background/50 px-6 py-4">
              <div className="flex items-end gap-3">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask Grace about a resident, meds, census, incident, or protocol..."
                  className="min-h-[92px] flex-1 resize-none border-violet-500/15 bg-background/80 focus-visible:ring-violet-500/40"
                />
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void toggleVoiceCapture()}
                    disabled={voicePending || graceBusy || !organizationId}
                    title={
                      recorder.recording
                        ? "Stop voice capture"
                        : "Start voice capture"
                    }
                    aria-label={
                      recorder.recording
                        ? "Stop voice capture"
                        : "Start voice capture"
                    }
                  >
                    {voicePending || recorder.recording ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Mic className="size-4" />
                    )}
                  </Button>
                  <Button
                    onClick={() => void send()}
                    disabled={
                      !input.trim() || graceBusy || !organizationId
                    }
                    size="icon"
                    className="bg-violet-600 hover:bg-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500"
                    aria-label="Send message"
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
