"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, NotebookText, Plus } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  PAGE_TEMPLATES,
  templateById,
  templateLabel,
  type QueryResult,
  type TemplateKind,
  type WorkspacePageRow,
} from "@/lib/office/workspace";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function AdminWorkspacePagesPage() {
  const supabase = createClient();
  const router = useRouter();

  const [pages, setPages] = useState<WorkspacePageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<TemplateKind | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const res = (await supabase
        .from("workspace_pages" as never)
        .select("id, owner_user_id, title, body, template_kind, visibility, version, updated_at, created_at")
        .eq("owner_user_id", actor.userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200)) as unknown as QueryResult<WorkspacePageRow>;
      if (res.error) throw new Error(res.error.message);
      setPages(res.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load your pages.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const createPage = useCallback(
    async (kind: TemplateKind) => {
      setCreatingKind(kind);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Could not resolve your profile.");
        const tpl = templateById(kind);
        const res = (await supabase
          .from("workspace_pages" as never)
          .insert({
            organization_id: actor.organizationId,
            owner_user_id: actor.userId,
            title: tpl.title,
            body: tpl.body,
            template_kind: kind,
            created_by: actor.userId,
            updated_by: actor.userId,
          } as never)
          .select("id")
          .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
        if (res.error) throw new Error(res.error.message);
        if (res.data?.id) router.push(`/admin/workspace/${res.data.id}`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to create the page.");
        setCreatingKind(null);
      }
    },
    [supabase, router],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <NotebookText className="h-8 w-8 text-info shrink-0" aria-hidden />
            My workspace
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Private-by-default notes and pages. Only you can see these unless you publish them.
            Owners/administrators can break-glass with a logged reason for compliance.
          </p>
        </header>

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        <section aria-labelledby="new-page-heading" className="space-y-2">
          <h3 id="new-page-heading" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            New page
          </h3>
          <div className="flex flex-wrap gap-2">
            {PAGE_TEMPLATES.map((t) => (
              <Button
                key={t.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={creatingKind !== null}
                onClick={() => void createPage(t.id)}
                className="gap-2"
              >
                {creatingKind === t.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                {t.label}
              </Button>
            ))}
          </div>
        </section>

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError ? (
          <section aria-labelledby="my-pages-heading" className="space-y-3">
            <div className="px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
              <h3 id="my-pages-heading" className="text-lg font-semibold text-foreground">
                My pages
                <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                  {pages.length}
                </span>
              </h3>
            </div>
            {pages.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-2">
                No pages yet — start one from a template above.
              </p>
            ) : (
              <ul className="space-y-2">
                {pages.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/admin/workspace/${p.id}`}
                      className={cn(
                        "flex items-center justify-between gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card",
                        "hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-semibold text-foreground truncate">{p.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {templateLabel(p.template_kind)} · v{p.version} · {ET_FMT.format(new Date(p.updated_at))} ET
                          </span>
                        </div>
                      </div>
                      <StatusPill tone={p.visibility === "private" ? "muted" : "info"}>
                        {p.visibility}
                      </StatusPill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
