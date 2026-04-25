import { notFound } from "next/navigation";

import { NewAdmissionForm } from "@/components/v2/forms/NewAdmissionForm";
import { uiV2 } from "@/lib/flags";
import { loadV2FormOptions } from "@/lib/v2-form-options";

export const dynamic = "force-dynamic";

export default async function NewAdmissionPage() {
  if (!uiV2()) notFound();
  const { facilities, residents } = await loadV2FormOptions();
  return <NewAdmissionForm facilities={facilities} residents={residents} />;
}
