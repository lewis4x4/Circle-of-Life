import { DocumentIntakeWorkspace } from "@/components/document-intake/DocumentIntakeWorkspace";
import { parseIntakeTab } from "@/components/document-intake/model";

/** Document Intake (COL-771, spec 41): received documents waiting for a person to check and file them. */
export default async function DocumentIntakePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <DocumentIntakeWorkspace initialTab={parseIntakeTab(tab)} />;
}
