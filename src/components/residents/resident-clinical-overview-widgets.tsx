"use client";

import * as React from "react";

import { StatusPill } from "@/components/ui/status-pill";
import { resolveCodeStatusPresentation } from "@/lib/residents/resident-code-status";
import { cn } from "@/lib/utils";

export { resolveCodeStatusPresentation } from "@/lib/residents/resident-code-status";

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
  if (!v) {
    return (
      <span className="text-[13px] font-medium text-muted-foreground">Not reviewed</span>
    );
  }
  if (v === "standard" || v === "normal" || v === "low") {
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
