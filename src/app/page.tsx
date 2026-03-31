export default function Home() {
  const supabaseReady = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.length &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length,
  );

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16 outline-none"
      >
        <p className="text-sm font-medium uppercase tracking-wide text-teal-700 dark:text-teal-400">
          Haven
        </p>
        <h1 className="text-3xl font-semibold leading-tight">
          Assisted living &amp; home care operations
        </h1>
        <p className="text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          Unified platform for multi-site operators—clinical workflows, compliance, workforce,
          families, and business data on one secure, role-governed layer. Foundation migrations and
          Supabase clients are wired; apply SQL to your project, then set{" "}
          <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
            .env.local
          </code>{" "}
          from{" "}
          <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
            .env.example
          </code>
          .
        </p>
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            supabaseReady
              ? "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100"
              : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          }`}
          role="status"
        >
          {supabaseReady
            ? "Supabase URL and anon key are configured for this environment."
            : "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local to enable auth and data access."}
        </div>
      </main>
    </div>
  );
}
