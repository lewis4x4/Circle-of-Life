import React from "react";
import { cn } from "@/lib/utils";

export function AmbientMatrix({ 
  hasCriticals = false,
  primaryClass = "bg-indigo-700/10",
  secondaryClass = "bg-emerald-900/10",
  criticalPrimaryClass = "bg-rose-700/30",
  criticalSecondaryClass = "bg-rose-900/20"
}: { 
  hasCriticals?: boolean;
  primaryClass?: string;
  secondaryClass?: string;
  criticalPrimaryClass?: string;
  criticalSecondaryClass?: string;
}) {
  return (
    <>
      <div className={cn(
        "fixed top-[-20%] right-[-10%] h-[800px] w-[800px] rounded-full blur-[120px] opacity-20 pointer-events-none transition-colors duration-[3000ms] ease-in-out -z-10",
        hasCriticals ? criticalPrimaryClass : primaryClass
      )} />
      <div className={cn(
        "fixed bottom-[-20%] left-[-10%] h-[600px] w-[600px] rounded-full blur-[100px] opacity-10 pointer-events-none transition-colors duration-[3000ms] ease-in-out -z-10",
        hasCriticals ? criticalSecondaryClass : secondaryClass
      )} />
    </>
  );
}
