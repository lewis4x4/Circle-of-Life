import Link from "next/link";

import { SURVEY_PACK_VIEWS, type SurveyPackView } from "@/lib/compliance/survey-pack-views";
import { cn } from "@/lib/utils";

export function SurveyPackViewsNav({ current }: { current: SurveyPackView }) {
  return (
    <nav aria-label="Survey pack views" className="flex flex-wrap gap-1 border-b border-border pb-2">
      {SURVEY_PACK_VIEWS.map((view) => (
        <Link
          key={view.id}
          href={view.href}
          aria-current={view.id === current ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view.id === current ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
