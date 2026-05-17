"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

export default function InfectionSurveillanceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const supabase = createClient();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: qErr } = await supabase
      .from("infection_surveillance")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setRow(data as Record<string, unknown>);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <RecordDetailHeader
        title="Surveillance record"
        backLink={{ label: "Infection control", href: "/admin/infection-control" }}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {row && (
        <RecordDetailSection
          title="Summary"
          description={`ID: ${String(row.id)}`}
        >
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Type:</span>{" "}
              {String(row.infection_type)}
            </p>
            <p>
              <span className="text-muted-foreground">Status:</span>{" "}
              {String(row.status)}
            </p>
            <p>
              <span className="text-muted-foreground">Onset:</span>{" "}
              {String(row.onset_date)}
            </p>
            {row.outbreak_id ? (
              <p>
                <span className="text-muted-foreground">Outbreak:</span>{" "}
                <Link
                  href={`/admin/infection-control/outbreaks/${String(row.outbreak_id)}`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </p>
            ) : null}
          </div>
        </RecordDetailSection>
      )}
    </div>
  );
}
