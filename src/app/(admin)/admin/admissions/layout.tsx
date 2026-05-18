import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Admissions overview",
};

export default function AdmissionsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
