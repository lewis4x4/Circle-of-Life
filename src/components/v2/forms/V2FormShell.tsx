"use client";

import { useState } from "react";

import { T5Form } from "@/design-system/templates";
import { cn } from "@/lib/utils";
import type { V2FormId } from "@/lib/v2-forms";

export type V2FormShellProps = {
  formId: V2FormId;
  title: string;
  subtitle?: string;
  steps?: { id: string; label: string; state?: "complete" | "active" | "pending" }[];
  children: React.ReactNode;
  isSubmitting: boolean;
  isValid: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  cancelHref?: string;
  submitLabel?: string;
  banner?: { tone: "info" | "warning" | "success" | "danger"; message: string };
};

const TONE_TO_BANNER: Record<NonNullable<V2FormShellProps["banner"]>["tone"], string> = {
  info: "border-info text-info",
  warning: "border-warning text-warning",
  success: "border-success text-success",
  danger: "border-danger text-danger",
};

const FIXED_NOW = new Date("2026-04-25T16:00:00-04:00");

export function V2FormShell({
  formId,
  title,
  subtitle,
  steps,
  children,
  isSubmitting,
  isValid,
  onSubmit,
  onCancel,
  cancelHref,
  submitLabel = "Save",
  banner,
}: V2FormShellProps) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <T5Form
      title={title}
      subtitle={subtitle}
      steps={steps}
      saveBar={
        <>
          {cancelHref ? (
            <a
              href={cancelHref}
              className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:border-border-strong"
            >
              Cancel
            </a>
          ) : onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:border-border-strong"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSubmitted(true);
              onSubmit();
            }}
            disabled={isSubmitting || !isValid}
            className="inline-flex h-8 items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Submitting…" : submitLabel}
          </button>
        </>
      }
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: FIXED_NOW.toISOString(),
        now: FIXED_NOW,
      }}
    >
      <p className="text-xs text-text-muted">
        V2 form · skeleton ({formId}). Submit posts to <code>/api/v2/forms/{formId}</code>{" "}
        which today returns a deferred envelope; live persistence wires in S10a.
      </p>

      {banner && (
        <p
          role="status"
          className={cn(
            "rounded-sm border bg-surface-subtle px-3 py-2 text-xs font-medium",
            TONE_TO_BANNER[banner.tone],
          )}
        >
          {banner.message}
        </p>
      )}

      {!banner && submitted && !isSubmitting && (
        <p
          role="status"
          className={cn(
            "rounded-sm border bg-surface-subtle px-3 py-2 text-xs font-medium",
            TONE_TO_BANNER.success,
          )}
        >
          Validation succeeded. Live submit lands in S10a.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </T5Form>
  );
}
