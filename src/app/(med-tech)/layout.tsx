import { MedTechShell } from "@/components/layout/MedTechShell";

export default function MedTechRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MedTechShell>{children}</MedTechShell>;
}
