import EmployeeFileClient from "@/components/staff/EmployeeFileClient";

export default async function EmployeeFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeFileClient key={id} staffId={id} />;
}
