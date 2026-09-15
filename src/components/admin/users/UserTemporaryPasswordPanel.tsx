"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Copy, Eye, EyeOff } from "lucide-react";

export function UserTemporaryPasswordPanel({ password }: { password: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success("Temporary password copied.");
    } catch {
      toast.error("Could not copy password. Select and copy it manually.");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
      <p className="text-sm font-medium text-warning">
        This password is shown once. Copy it now before closing.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          readOnly
          type={visible ? "text" : "password"}
          value={password}
          aria-label="Temporary password"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          className="min-h-11 min-w-0 flex-1 select-all font-mono text-sm"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide temporary password" : "Show temporary password"}
          className="min-h-11 gap-1"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {visible ? "Hide" : "Show"}
        </Button>
        <Button type="button" variant="outline" onClick={handleCopy} className="min-h-11 gap-1">
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
