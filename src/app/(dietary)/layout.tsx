import { DietaryShell } from "@/components/layout/DietaryShell";

export default function DietaryRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DietaryShell>{children}</DietaryShell>;
}
