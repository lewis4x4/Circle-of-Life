import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FAMILY_HOME_BULLETIN_EMPTY_DESCRIPTION,
  FAMILY_HOME_BULLETIN_EMPTY_TITLE,
  FAMILY_HOME_BULLETIN_HELPER,
  FAMILY_MESSAGES_LIST_LABEL,
} from "@/lib/family/family-portal-copy";

import { FamilyPortalUpdateLog } from "@/components/family-portal/FamilyPortalUpdateLog";

/**
 * Family /family/messages renders FamilyPortalUpdateLog with shared bulletin copy.
 * This test locks the one-way empty state language without mounting the full page shell.
 */
describe("family messages bulletin list empty state", () => {
  it("shows calm bulletin empty copy without chat or reply affordances", () => {
    render(
      <FamilyPortalUpdateLog
        items={[]}
        emptyTitle={FAMILY_HOME_BULLETIN_EMPTY_TITLE}
        emptyDescription={FAMILY_HOME_BULLETIN_EMPTY_DESCRIPTION}
        listLabel={FAMILY_MESSAGES_LIST_LABEL}
      />,
    );

    expect(screen.getByText(FAMILY_HOME_BULLETIN_EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(FAMILY_HOME_BULLETIN_EMPTY_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send|reply/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/start the conversation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no updates yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/journal is quiet/i)).not.toBeInTheDocument();
  });

  it("exposes one-way helper copy for training-week consistency", () => {
    expect(FAMILY_HOME_BULLETIN_HELPER).toMatch(/cannot reply in Haven/i);
    expect(FAMILY_HOME_BULLETIN_EMPTY_TITLE).toBe("No notes posted yet");
  });
});
