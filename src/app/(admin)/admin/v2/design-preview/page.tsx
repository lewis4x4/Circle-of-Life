import Link from "next/link";
import { notFound } from "next/navigation";

import { uiV2 } from "@/lib/flags";
import { UI_V2_PREVIEW_REGISTRY } from "@/design-system/dev-previews";

export const dynamic = "force-dynamic";

export default function UiV2DevIndex() {
  if (process.env.NODE_ENV === "production" || !uiV2()) {
    notFound();
  }

  const entries = Object.entries(UI_V2_PREVIEW_REGISTRY);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-caps text-text-muted">
          UI-V2 · S3 dev previews
        </span>
        <h1 className="text-2xl font-semibold text-text-primary">
          Primitives (shell + chrome)
        </h1>
        <p className="text-sm text-text-secondary max-w-2xl">
          Internal dev-only preview surface for UI-V2 primitives. Each entry
          renders the component in its defined states for visual + a11y
          regression checks. Not served in production.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {entries.map(([slug, entry]) => (
          <li key={slug}>
            <Link
              href={`/admin/v2/design-preview/${slug}`}
              className="block rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              <div className="text-xs font-semibold uppercase tracking-caps text-text-muted">
                {entry.code}
              </div>
              <div className="mt-1 text-base font-medium text-text-primary">
                {entry.name}
              </div>
              <div className="mt-1 text-xs text-text-secondary">
                {entry.description}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
