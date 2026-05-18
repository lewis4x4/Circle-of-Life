"use client";

import * as React from "react";

import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

type CodeSemantic = "neutral" | "attention" | "critical";

/** Maps stored `code_status` strings → clinician-safe Quiet Operator visuals. */
export function resolveCodeStatusPresentation(raw: string | null): {
  label: string;
  semantic: CodeSemantic;
} {
  const v = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");

  /* Missing documented code status — no colored pill (Quiet Operator absent-data rule). */
  if (!v) {
    return { label: "Not on file", semantic: "neutral" };
  }

  if (
    v === "full_code" ||
    v === "full" ||
    v === "resuscitative" ||
    v === "resuscitative_measures"
  ) {
    return { label: "Full code", semantic: "neutral" };
  }

  if (v.includes("hospice")) {
    return {
      label: "Hospice — palliative-focused goals of care",
      semantic: "critical",
    };
  }

  const hasDnr = v.includes("dnr") || v.includes("dnar") || v.includes("do_not_resuscitate");
  const hasDni =
    v.includes("dni") || v.includes("do_not_intubate") || v.includes("_dni");

  if (hasDnr && hasDni) {
    return { label: "DNR/DNI — Do not resuscitate / intubate", semantic: "attention" };
  }
  if (hasDni && !hasDnr) {
    return { label: "DNI — Do not intubate", semantic: "attention" };
  }
  if (hasDnr) {
    return { label: "DNR — Do not resuscitate", semantic: "attention" };
  }

  if (
    v.includes("comfort") ||
    v.includes("cmo") ||
    v.includes("allow_natural") ||
    v === "letting_go_plan"
  ) {
    return { label: "Comfort care only — no aggressive measures", semantic: "critical" };
  }

  /* Unknown / unmappable stored value — do not imply clinical state via warning/danger hue. */
  return { label: "Not on file", semantic: "neutral" };
}

export function ResidentCodeStatusValue({ raw }: { raw: string | null }) {
  const { label, semantic } = resolveCodeStatusPresentation(raw);

  if (semantic === "neutral") {
    return (
      <span className="text-[14px] font-medium leading-snug text-muted-foreground">{label}</span>
    );
  }

  if (semantic === "attention") {
    return (
      <StatusPill tone="warning" className="normal-case tracking-tight">
        {label}
      </StatusPill>
    );
  }

  return (
    <StatusPill tone="danger" className="normal-case tracking-tight">
      {label}
    </StatusPill>
  );
}

export type DatabaseHospice = "none" | "pending" | "active" | "ended";

export function hospiceElectionPhrase(raw: string | null): string {
  switch (raw) {
    case "pending":
      return "Pending hospice election";
    case "active":
      return "Active hospice election";
    case "ended":
      return "Hospice concluded";
    case "none":
    case null:
    case undefined:
    default:
      return "Not enrolled";
  }
}

export function polstMolstFriendly(status: string | null | undefined): string {
  switch (status ?? "none") {
    case "on_file":
      return "On file (unverified)";
    case "verified":
      return "Verified on file";
    case "revoked":
      return "Revoked / superseded";
    case "none":
    default:
      return "Not on file";
  }
}

export function ResidentFallRiskPresentation({ raw }: { raw: string | null }) {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "standard" || v === "normal" || v === "low") {
    return (
      <span className="text-[13px] font-medium tabular-nums text-muted-foreground">Standard baseline</span>
    );
  }
  if (v === "elevated" || v === "moderate" || v === "medium") {
    return (
      <StatusPill tone="warning" className="normal-case tracking-tight">
        Elevated fall risk
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="danger" className="normal-case tracking-tight">
      High fall risk
    </StatusPill>
  );
}

export function ResidentMetadataChipRow({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
