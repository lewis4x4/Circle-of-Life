import Link from "next/link";

export default function FamilyPortalConsentNewStubPage() {
  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6 pb-12 pt-2">
      <Link
        href="/admin/family-portal"
        className="inline-flex text-[13px] font-medium text-primary underline-offset-4 hover:underline"
      >
        ← Back to Family Connections
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Add consent record</h1>
        <p className="max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          Capture flows for HIPAA, photo release, and care planning consents are not wired in this segment. Align with
          admissions and compliance before building this surface.
        </p>
      </div>
    </div>
  );
}
