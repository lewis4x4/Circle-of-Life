export default function CaregiverLoading() {
  return (
    <div className="animate-pulse space-y-4 p-4">
      <div className="h-8 w-40 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          />
        ))}
      </div>
    </div>
  );
}
