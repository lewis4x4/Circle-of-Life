import { createClient } from "@/lib/supabase/server";

export type V2UserRow = {
  id: string;
  email: string | null;
  fullName: string | null;
  appRole: string | null;
  jobTitle: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
};

export type V2UsersLoad = {
  rows: V2UserRow[];
};

type DbRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  app_role: string | null;
  job_title: string | null;
  is_active: boolean;
  last_login_at: string | null;
};

type Result = { data: DbRow[] | null; error: { message: string } | null };

export async function loadV2Users(): Promise<V2UsersLoad> {
  const supabase = await createClient();
  const result = (await supabase
    .from("user_profiles" as never)
    .select("id, email, full_name, app_role, job_title, is_active, last_login_at")
    .is("deleted_at" as never, null as never)
    .order("full_name" as never, { ascending: true })) as unknown as Result;

  if (result.error || !result.data) {
    return { rows: [] };
  }

  return {
    rows: result.data.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      appRole: row.app_role,
      jobTitle: row.job_title,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at,
    })),
  };
}
