import { notFound } from "next/navigation";

import { KioskSignInForm } from "@/components/kiosk/KioskSignInForm";
import { isKioskVisitorKind } from "@/lib/kiosk/contract";

export default async function KioskSignInPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isKioskVisitorKind(kind)) notFound();
  return <KioskSignInForm kind={kind} />;
}
