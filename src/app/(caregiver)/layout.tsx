import { CaregiverShell } from "@/components/layout/CaregiverShell";

export default function CaregiverRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CaregiverShell>{children}</CaregiverShell>;
}
