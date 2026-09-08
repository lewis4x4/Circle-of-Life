import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployeeFileClient from "@/components/staff/EmployeeFileClient";
import type { EmployeeSummary } from "@/lib/staff/employee-file";

export default async function MyEmployeeFile({ searchParams }: { searchParams: Promise<{ staff?: string }> }) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=/employee-file");
  const result = await client.rpc("haven_employee_file_staff" as never, { p_staff_id: null } as never);
  const data = ((result.data ?? []) as EmployeeSummary[]).filter((s) => s.user_id === user.id);
  const error = result.error;
  if (error) return <main className="p-6"><h1>My employee file</h1><p role="alert">Your employee record could not be loaded. Please sign in again or contact your administrator.</p></main>;
  const requested = (await searchParams).staff;
  const selected = data?.find((s) => s.id === requested) ?? (data?.length === 1 ? data[0] : null);
  if (selected) return <EmployeeFileClient key={selected.id} staffId={selected.id} selfService />;
  return <main className="space-y-4 p-6"><h1 className="text-2xl font-semibold">My employee file</h1>{data?.length ? <ul>{data.map((s) => <li key={s.id}><Link href={`/employee-file?staff=${s.id}`}>{s.first_name} {s.last_name} · {s.facility_name ?? "Assigned community"}</Link></li>)}</ul> : <p>No employee record is linked to your account. Ask your administrator to link your existing record.</p>}</main>;
}
