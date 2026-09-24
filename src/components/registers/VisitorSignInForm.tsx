"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EMPTY_VISITOR_DRAFT,
  VISITING_TYPES,
  VISITOR_TYPES,
  validateVisitorSignIn,
  type VisitingTypeId,
  type VisitorSignInDraft,
  type VisitorTypeId,
} from "@/lib/registers/visitor-log";

import type { VisitableResident } from "./VisitorLogClient";

export const VISITOR_INPUT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";
const inputCls = VISITOR_INPUT_CLASS;

/**
 * The desk's own sign-in form. Built for somebody standing at a door on a
 * phone: every control is labelled, the whole flow is keyboard operable, and
 * submitting returns focus to the name field for the next visitor in the queue.
 */
export function VisitorSignInForm({
  residents,
  onSignIn,
  onSaved,
  onNotice,
}: {
  residents: VisitableResident[];
  onSignIn: (draft: VisitorSignInDraft) => Promise<void>;
  /** Reloads the log after a sign-in. */
  onSaved: () => Promise<void>;
  onNotice: (notice: string | null) => void;
}) {
  const [draft, setDraft] = useState<VisitorSignInDraft>(EMPTY_VISITOR_DRAFT);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validateVisitorSignIn(draft);
    setProblems(found);
    if (found.length > 0) return;
    setSaving(true);
    onNotice(null);
    try {
      await onSignIn(draft);
      setDraft(EMPTY_VISITOR_DRAFT);
      await onSaved();
      // Back to the name field: there is usually another person behind them.
      nameRef.current?.focus();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "The visitor could not be signed in.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="visitor-sign-in-heading" className="space-y-3">
      <h2 id="visitor-sign-in-heading" className="text-sm font-medium text-foreground">
        Sign in visitor
      </h2>
      <form onSubmit={submit} className="grid gap-3 rounded-[var(--radius)] border border-border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="visitor-name" className="text-xs text-muted-foreground">
            Visitor name
          </label>
          <input
            id="visitor-name"
            ref={nameRef}
            type="text"
            autoComplete="off"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            aria-invalid={problems.some((p) => p.includes("name")) || undefined}
            aria-describedby={problems.length > 0 ? "visitor-problems" : undefined}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="visitor-phone" className="text-xs text-muted-foreground">
            Phone (optional)
          </label>
          <input
            id="visitor-phone"
            type="tel"
            autoComplete="off"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            aria-invalid={problems.some((p) => p.includes("phone")) || undefined}
            aria-describedby={problems.length > 0 ? "visitor-problems" : undefined}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="visitor-type" className="text-xs text-muted-foreground">
            Visitor type
          </label>
          <select
            id="visitor-type"
            value={draft.visitorType}
            onChange={(event) => setDraft({ ...draft, visitorType: event.target.value as VisitorTypeId })}
            className={inputCls}
          >
            {VISITOR_TYPES.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs text-muted-foreground">Visiting</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Visiting">
            {VISITING_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={draft.visitingType === type.id}
                onClick={() =>
                  setDraft({
                    ...draft,
                    visitingType: type.id as VisitingTypeId,
                    residentId: type.id === "resident" ? draft.residentId : "",
                  })
                }
                className={
                  draft.visitingType === type.id
                    ? "h-10 flex-1 rounded-md border border-foreground bg-foreground px-2 text-sm text-background"
                    : "h-10 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                }
              >
                {type.label}
              </button>
            ))}
          </div>
        </fieldset>
        {draft.visitingType === "resident" ? (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="visitor-resident" className="text-xs text-muted-foreground">
              Resident
            </label>
            <select
              id="visitor-resident"
              value={draft.residentId}
              onChange={(event) => setDraft({ ...draft, residentId: event.target.value })}
              aria-invalid={problems.some((p) => p.includes("resident")) || undefined}
              aria-describedby={problems.length > 0 ? "visitor-problems" : undefined}
              className={inputCls}
            >
              <option value="">Choose a resident…</option>
              {residents.map((resident) => (
                <option key={resident.id} value={resident.id}>
                  {resident.lastName}, {resident.firstName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {problems.length > 0 ? (
          <ul id="visitor-problems" className="space-y-1 text-sm text-destructive sm:col-span-2">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Sign in
          </Button>
        </div>
      </form>
    </section>
  );
}
