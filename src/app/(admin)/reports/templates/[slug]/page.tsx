import Link from "next/link";
import { notFound } from "next/navigation";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { cn } from "@/lib/utils";

export default async function ReportTemplateDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = PHASE1_TEMPLATE_SEED.find((item) => item.slug === slug);
  if (!template) return notFound();

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
