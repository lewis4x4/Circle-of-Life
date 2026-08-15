/**
 * Quiet Operator copy for office team user labels.
 * Missing users and blank profile fields name real gaps — never "Unknown" or fabricated names.
 */

export const TEAMS_NO_USER_COPY = "No user posted";
export const TEAMS_NO_NAME_COPY = "No name posted";

const EM_DASH = "—";

export type TeamUserLabelFields = {
  full_name: string;
  email: string;
};

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

/** Team member / page owner label when the user row is missing or profile fields are unset. */
export function formatTeamUserLabel(user: TeamUserLabelFields | null | undefined): string {
  if (user == null) return TEAMS_NO_USER_COPY;

  const name = user.full_name;
  const email = user.email;

  if (isBlankOrEmDash(name) && isBlankOrEmDash(email)) return TEAMS_NO_NAME_COPY;
  if (!isBlankOrEmDash(name)) return String(name).trim();

  return String(email).trim();
}
