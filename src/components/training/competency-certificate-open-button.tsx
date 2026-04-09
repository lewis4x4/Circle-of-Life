"use client";

import { useCallback, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { COMPETENCY_CERTIFICATE_BUCKET } from "@/lib/training/competency-storage";

type Props = {
  storagePath: string;
  label: string;
  className?: string;
};

export function CompetencyCertificateOpenButton({ storagePath, label, className }: Props) {
  const [busy, setBusy] = useState(false);
  const open = useCallback(async () => {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from(COMPETENCY_CERTIFICATE_BUCKET)
        .createSignedUrl(storagePath, 3600);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("No signed URL returned.");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[competency certificate]", e);
    } finally {
      setBusy(false);
    }
  }, [storagePath]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={busy}
      onClick={() => void open()}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
      {label}
    </Button>
  );
}
