export type SpaceRole = "member" | "lead";

export type TeamSpaceRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
};

export type TeamSpaceMemberRow = {
  id: string;
  team_space_id: string;
  user_id: string;
  space_role: SpaceRole;
  created_at: string;
};

export type OrgUserMini = {
  id: string;
  full_name: string;
  email: string;
  app_role: string;
};

export type TeamSharedPageRow = {
  id: string;
  title: string;
  owner_user_id: string;
  updated_at: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function userLabel(id: string, users: OrgUserMini[]): string {
  const u = users.find((x) => x.id === id);
  return u ? u.full_name || u.email : "Unknown";
}
