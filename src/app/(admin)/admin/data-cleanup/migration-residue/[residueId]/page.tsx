import Link from "next/link";

interface PageProps {
  params: Promise<{ residueId: string }>;
}

export default async function MigrationResidueDetailPage(props: PageProps) {
  const params = await props.params;
  const id = decodeURIComponent(params.residueId);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold text-foreground">Pending import review</h1>
      <p className="text-sm text-muted-foreground">
        Review pending import item <span className="font-mono text-foreground">{id}</span>. Use the facility record to
        verify source data before record updates.
      </p>
      <Link href="/admin/facilities" className="text-sm text-primary underline-offset-4 hover:underline">
        ← Facilities
      </Link>
    </div>
  );
}
