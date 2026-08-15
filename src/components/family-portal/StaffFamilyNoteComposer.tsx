"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  familyDeliveryMethodOptions,
  type FamilyDeliveryMethod,
} from "@/lib/admin/family-messages-data";
import { cn } from "@/lib/utils";

export type StaffFamilyNoteComposerProps = {
  draft: string;
  deliveryMethod: FamilyDeliveryMethod;
  posting?: boolean;
  disabled?: boolean;
  error?: string | null;
  onDraftChange: (value: string) => void;
  onDeliveryMethodChange: (value: FamilyDeliveryMethod) => void;
  onPost: () => void;
  className?: string;
};

export function StaffFamilyNoteComposer({
  draft,
  deliveryMethod,
  posting = false,
  disabled = false,
  error,
  onDraftChange,
  onDeliveryMethodChange,
  onPost,
  className,
}: StaffFamilyNoteComposerProps) {
  const canPost = draft.trim().length > 0 && !posting && !disabled;

  return (
    <section
      aria-label="Post family portal update"
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-4 shadow-sm",
        className,
      )}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">Post an update</h3>
        <p className="text-xs text-muted-foreground">
          One-way note to the family portal. Families cannot reply from Haven.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="family-note-delivery"
            className="text-xs text-muted-foreground"
          >
            Delivery
          </label>
          <select
            id="family-note-delivery"
            value={deliveryMethod}
            disabled={disabled || posting}
            onChange={(event) =>
              onDeliveryMethodChange(event.target.value as FamilyDeliveryMethod)
            }
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {familyDeliveryMethodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <textarea
          id="family-note-body"
          placeholder="Write an update for the family portal…"
          value={draft}
          disabled={disabled || posting}
          onChange={(event) => onDraftChange(event.target.value)}
          maxLength={8000}
          rows={4}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (canPost) onPost();
            }
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {draft.length}/8000 · Cmd+Enter to post
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canPost}
            onClick={onPost}
          >
            {posting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Posting…
              </>
            ) : (
              "Post update"
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
