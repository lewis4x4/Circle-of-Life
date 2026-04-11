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
import { graceOrchestrate } from "./api";
import { pushGracePresence } from "./presence";
import { useGraceStore } from "./store";
import { filterGraceTemplates } from "./templates";
import { useGraceKnowledgeStream } from "./useGraceKnowledgeStream";
import { graceSpeak, cancelGraceSpeech } from "./voice/tts";
import { transcribeGraceAudio, useGraceVoiceRecorder } from "./voice/useGraceVoiceRecorder";
import type { GraceChatMessage, GraceKnowledgeSource, GraceTemplate } from "./types";

interface SendOptions {
  mode?: "text" | "voice";
  knowledgeOnly?: boolean;
}

function sourceKey(source: GraceKnowledgeSource): string {
  return `${source.title}-${source.section_title ?? ""}-${source.confidence}`;
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
  const [input, setInput] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastNarratedTextRef = useRef("");
  const knowledge = useGraceKnowledgeStream();
  const recorder = useGraceVoiceRecorder();

  const templates = useMemo(() => filterGraceTemplates(appRole), [appRole]);
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
      chatPatchLast({
        content: knowledge.text,
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
  }, [chatPatchLast, knowledge.error, knowledge.meta, knowledge.sources, knowledge.status, knowledge.text, setConversationId]);

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
        throw new Error("Grace needs an organization context before it can answer.");
      }
      appendAssistantPlaceholder();
      await knowledgeStart({
        message,
        conversationId: state.conversationId ?? undefined,
        organizationId,
        route: pathname,
      });
    },
    [appendAssistantPlaceholder, knowledgeStart, organizationId, pathname, state.conversationId],
  );

  const send = useCallback(
    async (explicitText?: string, options: SendOptions = {}) => {
      const message = (explicitText ?? input).trim();
      if (!message || classifying || knowledge.status === "streaming") return;

      cancelGraceSpeech();
      setInput("");
      setError(null);
      setLastInputMode(options.mode ?? "text");

      chatAppend({
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        createdAt: Date.now(),
      });

      if (options.knowledgeOnly) {
        await streamKnowledge(message);
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
          await streamKnowledge(message);
          return;
        }

        if (classification.category === "FLOW_DISPATCH" && result.flow_definition && result.conversation_id) {
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
        await streamKnowledge(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Grace request failed";
        setError(message);
        chatAppend({
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
          createdAt: Date.now(),
        });
        pushGracePresence("grace-error", "alert", { ttlMs: 3000 });
      } finally {
        release();
        setClassifying(false);
      }
    },
    [
      chatAppend,
      classifying,
      input,
      knowledge.status,
      pathname,
      setConversationId,
      setError,
      setLastInputMode,
      startFlow,
      state.conversationId,
      streamKnowledge,
    ],
  );

  const handleTemplateClick = useCallback(
    async (template: GraceTemplate) => {
      if (template.phrase) {
        setInput(template.phrase);
      }
      if (template.id === "ask_grace") {
        openBar();
        window.setTimeout(() => textareaRef.current?.focus(), 0);
        return;
      }
      if (template.knowledge_only && template.phrase.trim().length > 0) {
        await send(template.phrase, { knowledgeOnly: true });
      }
      if (template.flow_slug && template.phrase.trim().length > 0) {
        await send(template.phrase);
      }
    },
    [openBar, send],
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
        setError(error instanceof Error ? error.message : "Voice transcription failed");
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
      <DialogContent className="flex h-[min(88vh,760px)] max-w-5xl flex-col overflow-hidden border-white/10 bg-background/95 p-0 backdrop-blur">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-violet-500" />
                Grace
              </DialogTitle>
              <DialogDescription>
                Care companion for residents, operations, and policy guidance.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  if (state.narrationEnabled) cancelGraceSpeech();
                  setNarrationEnabled(!state.narrationEnabled);
                }}
                title={state.narrationEnabled ? "Disable narration" : "Enable narration"}
                aria-label={state.narrationEnabled ? "Disable narration" : "Enable narration"}
              >
                {state.narrationEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  knowledgeCancel();
                  cancelGraceSpeech();
                }}
                title="Stop response"
                aria-label="Stop response"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="border-r bg-muted/20 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Quick actions
            </div>
            <div className="grid gap-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => void handleTemplateClick(template)}
                  className="rounded-2xl border border-border bg-background px-4 py-3 text-left transition hover:border-violet-300/60 hover:bg-violet-50/40 dark:hover:bg-violet-500/10"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <template.icon className="size-4 text-violet-500" />
                    <div className="text-sm font-semibold">{template.title}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{template.subtitle}</div>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {state.errorBanner ? (
                <div className="rounded-2xl border border-rose-300/50 bg-rose-50/80 p-4 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                  {state.errorBanner}
                </div>
              ) : null}

              {state.chatMessages.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-border bg-muted/20 p-8 text-center">
                  <Bot className="mx-auto mb-3 size-8 text-violet-500" />
                  <div className="text-lg font-semibold">Ask Grace anything</div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ask about residents, medications, census, incidents, compliance, and uploaded protocols.
                  </p>
                </div>
              ) : null}

              {state.chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[88%] rounded-3xl px-4 py-3 shadow-sm ${
                    message.role === "user"
                      ? "ml-auto bg-violet-600 text-white"
                      : "bg-muted/40 text-foreground"
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm">{message.content || (message.pending ? "Grace is thinking..." : "")}</div>
                  {message.citations?.length ? (
                    <div className="mt-3 grid gap-2">
                      {message.citations.map((source) => (
                        <div key={sourceKey(source)} className="rounded-2xl border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
                          <div className="font-medium text-foreground">{source.title}</div>
                          <div className="mt-1">{source.excerpt}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}

              {(classifying || knowledge.status === "connecting") ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Grace is routing your request...
                </div>
              ) : null}

              {knowledge.kbEmpty ? (
                <div className="rounded-2xl border border-amber-300/40 bg-amber-50/60 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  Grace could not find matching uploaded documents. Live operational tools still work, but policy answers improve once materials are uploaded under `/admin/knowledge/admin`.
                </div>
              ) : null}
            </div>

            <div className="border-t px-6 py-4">
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
                  className="min-h-[92px] flex-1 resize-none"
                />
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void toggleVoiceCapture()}
                    disabled={voicePending}
                    title={recorder.recording ? "Stop voice capture" : "Start voice capture"}
                    aria-label={recorder.recording ? "Stop voice capture" : "Start voice capture"}
                  >
                    {voicePending || recorder.recording ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Mic className="size-4" />
                    )}
                  </Button>
                  <Button
                    onClick={() => void send()}
                    disabled={!input.trim() || classifying || knowledge.status === "streaming"}
                    size="icon"
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
