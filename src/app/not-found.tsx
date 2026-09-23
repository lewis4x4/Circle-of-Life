import Link from "next/link";
import { Compass } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

/**
 * Branded 404 (COL-654). Replaces Next's unstyled default for every unmatched URL and
 * every `notFound()`. "/" forwards a signed-in user to their role home via /login, and
 * anyone else to sign-in, so one link is the way back for every role.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="flex w-full max-w-md flex-col items-start gap-4 rounded-lg border border-border bg-card p-6">
        <Compass aria-hidden className="h-6 w-6 text-muted-foreground" />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
          <p className="text-sm text-muted-foreground">
            The link may be out of date, or the page may have moved. Nothing was changed.
          </p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "default" })}>
          Go to my home page
        </Link>
      </div>
    </main>
  );
}
