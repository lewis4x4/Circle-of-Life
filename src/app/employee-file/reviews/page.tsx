import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeSummary } from "@/lib/staff/employee-file";

export default async function AssignedEmployeeReviews() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=/employee-file/reviews");
  const grants = await client.from("employee_medical_access" as never).select("facility_id").eq("user_id", user.id).is("revoked_at", null);
  if (grants.error) return <main className="p-6"><p role="alert">Reviewer access could not be verified. Please sign in again.</p></main>;
  const facilities = (grants.data as { facility_id: string }[]).map((g) => g.facility_id);
  const result = facilities.length ? await client.rpc("haven_employee_file_staff" as never, { p_staff_id: null } as never) : { data: [], error: null };
  const staff = ((result.data ?? []) as EmployeeSummary[]).filter((s) => facilities.includes(s.facility_id));
  return <main className="space-y-4 p-6"><Link className="text-sm underline" href="/employee-file">My employee file</Link><h1 className="text-2xl font-semibold">Assigned medical-file reviews</h1>{result.error ? <p role="alert">Employee records could not be loaded.</p> : !staff.length ? <p>No employee files are available under your current reviewer access.</p> : <ul className="space-y-3">{staff.map((s) => <li key={s.id}><Link className="underline" href={`/employee-file/reviews/${s.id}`}>{s.first_name} {s.last_name} · {s.facility_name ?? "Assigned community"}</Link></li>)}</ul>}</main>;
}
