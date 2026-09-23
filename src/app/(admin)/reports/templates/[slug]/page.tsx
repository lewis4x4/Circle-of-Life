import { notFound } from "next/navigation";

import { ReportTemplateDetail } from "@/components/reports/report-template-detail";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";

export default async function ReportTemplateDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = PHASE1_TEMPLATE_SEED.find((item) => item.slug === slug);
  if (!template) return notFound();

  return <ReportTemplateDetail template={template} />;
}
