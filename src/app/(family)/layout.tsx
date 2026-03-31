import { FamilyShell } from "@/components/layout/FamilyShell";

export default function FamilyRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FamilyShell>{children}</FamilyShell>;
}
