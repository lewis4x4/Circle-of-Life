import { notFound } from "next/navigation";

import { DocumentIntakeReview } from "@/components/document-intake/DocumentIntakeReview";
import { UUID_STRING_RE } from "@/lib/supabase/env";

/** One received document: original on the left, review and filing on the right (COL-771, DI-03). */
export default async function DocumentIntakeItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  if (!UUID_STRING_RE.test(itemId)) notFound();
  return <DocumentIntakeReview itemId={itemId} />;
}
