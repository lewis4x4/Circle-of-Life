"use client";

import { Download } from "lucide-react";

import { useOnboardingStore } from "@/hooks/useOnboardingStore";
import { downloadTextFile } from "@/lib/onboarding/download";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  variant?: "default" | "outline";
}

export function ExportMarkdownButton({ className, variant = "default" }: Props) {
  const exportMarkdown = useOnboardingStore((s) => s.exportMarkdown);

  function handleClick() {
    const md = exportMarkdown();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`haven-onboarding-export-${stamp}.md`, md, "text/markdown;charset=utf-8");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        buttonVariants({ variant: variant === "outline" ? "outline" : "default" }),
        variant === "default" && "bg-teal-500 text-slate-950 hover:bg-teal-400",
        variant === "outline" && "border-white/20 bg-transparent text-slate-100 hover:bg-white/10",
        className,
      )}
    >
      <Download className="mr-2 h-4 w-4" />
      Export answers (Markdown)
    </button>
  );
}
