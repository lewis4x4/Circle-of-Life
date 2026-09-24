"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import MyAcknowledgmentsPage from "@/app/(admin)/admin/acknowledgments/my/page";
import { CaregiverPendingPoliciesList } from "@/components/caregiver/CaregiverPendingPoliciesList";
import { REQUIRED_READING_TABS, requiredReadingTab } from "@/lib/caregiver/required-reading";
import { cn } from "@/lib/utils";

/** Required reading: one floor-app page, documents to sign and policies as tabs (COL-707). */
export default function CaregiverRequiredReadingPage() {
  const tab = requiredReadingTab(useSearchParams().get("tab"));
  return (
    <div className="space-y-4">
      <nav aria-label="Required reading" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {REQUIRED_READING_TABS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.id === tab ? "page" : undefined}
            className={cn(
              "inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              item.id === tab ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "policies" ? <CaregiverPendingPoliciesList /> : <MyAcknowledgmentsPage />}
    </div>
  );
}
