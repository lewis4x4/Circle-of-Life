import { describe, expect, it } from "vitest";

import type { OrgUserMini } from "@/lib/office/teams";
import {
  TEAMS_NO_NAME_COPY,
  TEAMS_NO_USER_COPY,
  formatTeamUserLabel,
  type TeamUserLabelFields,
} from "./teams-display-copy";

const EM_DASH = "—";

function mini(overrides: Partial<TeamUserLabelFields> & { id: string }): OrgUserMini {
  return {
    full_name: "",
    email: "",
    app_role: "staff",
    ...overrides,
  };
}

describe("formatTeamUserLabel", () => {
  it("names a missing user instead of Unknown", () => {
    expect(formatTeamUserLabel(null)).toBe(TEAMS_NO_USER_COPY);
    expect(formatTeamUserLabel(undefined)).toBe(TEAMS_NO_USER_COPY);
    expect(formatTeamUserLabel(null)).not.toBe("Unknown");
  });

  it("names blank full_name and email instead of Unknown", () => {
    const user = mini({ id: "user-1", full_name: "", email: "" });
    expect(formatTeamUserLabel(user)).toBe(TEAMS_NO_NAME_COPY);
    expect(formatTeamUserLabel(mini({ id: "user-2", full_name: "   ", email: "  " }))).toBe(
      TEAMS_NO_NAME_COPY,
    );
  });

  it("names em dash full_name and email instead of a silent dash", () => {
    const user = mini({ id: "user-3", full_name: EM_DASH, email: EM_DASH });
    expect(formatTeamUserLabel(user)).toBe(TEAMS_NO_NAME_COPY);
    expect(formatTeamUserLabel(mini({ id: "user-4", full_name: `  ${EM_DASH}  `, email: EM_DASH }))).toBe(
      TEAMS_NO_NAME_COPY,
    );
  });

  it("returns a posted full_name trimmed when present", () => {
    const user = mini({
      id: "user-5",
      full_name: "  Jordan Lee  ",
      email: "jordan@example.com",
    });
    expect(formatTeamUserLabel(user)).toBe("Jordan Lee");
  });

  it("returns a posted email trimmed when full_name is blank", () => {
    const user = mini({ id: "user-6", full_name: "", email: "  jordan@example.com  " });
    expect(formatTeamUserLabel(user)).toBe("jordan@example.com");
  });

  it("prefers full_name over email when both are posted", () => {
    const user = mini({
      id: "user-7",
      full_name: "Jordan Lee",
      email: "jordan@example.com",
    });
    expect(formatTeamUserLabel(user)).toBe("Jordan Lee");
  });
});
