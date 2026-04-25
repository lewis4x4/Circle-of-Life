import Link from "next/link";
import { notFound } from "next/navigation";

import { uiV2 } from "@/lib/flags";
import { UI_V2_PREVIEW_REGISTRY } from "@/design-system/dev-previews";

export const dynamic = "force-dynamic";

export default async function UiV2DevPreviewPage({
  params,
}: {
  params: Promise<{ component: string }>;
}) {
  if (process.env.NODE_ENV === "production" || !uiV2()) {
    notFound();
  }

  const { component } = await params;
  const entry = UI_V2_PREVIEW_REGISTRY[component];
  if (!entry) notFound();

  const PreviewComponent = entry.Preview;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/admin/v2/design-preview"
          className="text-xs font-semibold uppercase tracking-caps text-brand-primary hover:text-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          ← All primitives
        </Link>
        <h1 className="text-2xl font-semibold text-text-primary">
          {entry.code} · {entry.name}
        </h1>
        <p className="text-sm text-text-secondary max-w-2xl">{entry.description}</p>
      </header>

      <div data-ui-v2-preview={component} className="flex flex-col gap-6">
        <PreviewComponent />
      </div>
    </div>
  );
}
