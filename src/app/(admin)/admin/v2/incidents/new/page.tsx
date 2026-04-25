import { notFound } from "next/navigation";

import { NewIncidentForm } from "@/components/v2/forms/NewIncidentForm";
import { uiV2 } from "@/lib/flags";
import { loadV2FormOptions } from "@/lib/v2-form-options";

export const dynamic = "force-dynamic";

export default async function NewIncidentPage() {
  if (!uiV2()) notFound();
  const { facilities, residents } = await loadV2FormOptions();
  return <NewIncidentForm facilities={facilities} residents={residents} />;
}
