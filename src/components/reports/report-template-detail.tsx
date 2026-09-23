"use client";

import Link from "next/link";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import type { Phase1TemplateSeed } from "@/lib/reports/templates";
import { cn } from "@/lib/utils";

// Client component on purpose (COL-642): `buttonVariants` lives in a
// "use client" module and `Badge` calls base-ui hooks, so neither can run
// inside a Server Component. Rendering them from the async server page threw
// in the RSC render and every template detail page crashed (React #441).
export function ReportTemplateDetail({ template }: { template: Phase1TemplateSeed }) {
  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <RecordDetailHeader
        title={template.name}
        subtitle={template.description}
        backLink={{ label: "Back to templates", href: "/admin/reports/templates" }}
      />
      <RecordDetailSection title="Definition">
        <div className="space-y-3 text-sm text-foreground">
          <p>
            <span className="font-medium">Audience:</span> {template.audience}
          </p>
          <p>
            <span className="font-medium">Category:</span> {template.category}
          </p>
          <p>
            <span className="font-medium">Default range:</span>{" "}
            {template.defaultRange}
          </p>
          <div className="flex flex-wrap gap-2">
            {template.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link href={`/admin/reports/run/template/${template.slug}`} className={cn(buttonVariants({}))}>
              Run now
            </Link>
            <Link href={`/admin/reports/saved?fromTemplate=${template.slug}`} className={cn(buttonVariants({ variant: "outline" }))}>
              Save variant
            </Link>
            <Link href={`/admin/reports/scheduled?fromTemplate=${template.slug}`} className={cn(buttonVariants({ variant: "outline" }))}>
              Schedule
            </Link>
            <Link href={`/admin/reports/packs?fromTemplate=${template.slug}`} className={cn(buttonVariants({ variant: "outline" }))}>
              Add to pack
            </Link>
          </div>
        </div>
      </RecordDetailSection>
    </div>
  );
}
