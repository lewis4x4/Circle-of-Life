import Link from "next/link";
import { notFound } from "next/navigation";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{template.name}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{template.description}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Definition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
          <p>
            <span className="font-medium text-slate-900 dark:text-slate-100">Audience:</span> {template.audience}
          </p>
          <p>
            <span className="font-medium text-slate-900 dark:text-slate-100">Category:</span> {template.category}
          </p>
          <p>
            <span className="font-medium text-slate-900 dark:text-slate-100">Default range:</span>{" "}
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
        </CardContent>
      </Card>
    </div>
  );
}
