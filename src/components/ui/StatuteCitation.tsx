"use client";

import React, { useEffect, useState } from "react";
import { z } from "zod";

import { createClient } from "@/lib/supabase/client";

type Props = {
  /** e.g. `59A-36.018` or `429.28` */
  statuteCode: string;
  children: React.ReactNode;
  className?: string;
  /** Defaults to COL pilot org */
  organizationId?: string;
};

const uuidSchema = z.string().uuid();

/**
 * Hover/focus tooltip backed by `fl_statutes` (RLS: org staff can read).
 */
const COL_PILOT_ORG = "00000000-0000-0000-0000-000000000001";

export function StatuteCitation({
  statuteCode,
  children,
  className,
  organizationId = COL_PILOT_ORG,
}: Props) {
  const [label, setLabel] = useState<string | null>(null);

  const resolvedOrgId = uuidSchema.safeParse(organizationId).success
    ? organizationId!
    : COL_PILOT_ORG;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("fl_statutes")
        .select("statute_title, description")
        .eq("organization_id", resolvedOrgId)
        .eq("statute_code", statuteCode)
        .is("deleted_at", null)
        .maybeSingle();
      if (cancelled || error) return;
      if (!data) return;
      const tip = [data.statute_title, data.description].filter(Boolean).join(" — ");
      setLabel(tip);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [statuteCode, resolvedOrgId]);

  return (
    <span
      className={className}
      title={label ?? `Florida statute ${statuteCode}`}
      tabIndex={0}
    >
      {children}
    </span>
  );
}
