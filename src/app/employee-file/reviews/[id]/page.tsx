import { notFound } from "next/navigation";
import EmployeeFileClient from "@/components/staff/EmployeeFileClient";
import { employeeFileActor } from "@/lib/staff/employee-file-server";

export default async function EmployeeReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await employeeFileActor(id);
  if ("response" in access) notFound();
  return <EmployeeFileClient key={id} staffId={id} selfService />;
}
