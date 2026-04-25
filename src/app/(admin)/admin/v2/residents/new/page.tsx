import { notFound } from "next/navigation";

import { NewResidentForm } from "@/components/v2/forms/NewResidentForm";
import { uiV2 } from "@/lib/flags";
import { loadV2FormOptions } from "@/lib/v2-form-options";

export const dynamic = "force-dynamic";

export default async function NewResidentPage() {
  if (!uiV2()) notFound();
  const { facilities } = await loadV2FormOptions();
  return <NewResidentForm facilities={facilities} />;
}
