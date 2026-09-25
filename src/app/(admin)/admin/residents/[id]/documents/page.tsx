"use client";

import { useParams } from "next/navigation";

import { ResidentDocumentsList } from "@/components/document-intake/ResidentDocumentsList";
import { RecordDetailSection } from "@/design-system/components/record-detail";

/**
 * Resident Documents tab: the current documents on the resident's record,
 * including those filed from Document Intake (COL-771). The resident <h1> and
 * tab strip come from AdminResidentDetailShell; this tab adds an <h2> section.
 */
export default function ResidentDocumentsPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";

  return (
    <div className="relative w-full space-y-6 pb-12">
      <RecordDetailSection title="Documents" description="Newest first. Each document opens in a new tab.">
        <ResidentDocumentsList residentId={residentId} />
      </RecordDetailSection>
    </div>
  );
}
