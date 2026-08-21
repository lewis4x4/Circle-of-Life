import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FAMILY_BULLETIN_RESIDENT_LOG_LOADING_MESSAGE } from "@/lib/admin/family-messages-copy";
import { FamilyPortalUpdateLog } from "./FamilyPortalUpdateLog";

describe("<FamilyPortalUpdateLog />", () => {
  it("shows named loading copy instead of a spinner-only wait", () => {
    render(
      <FamilyPortalUpdateLog
        items={[]}
        loading
        loadingMessage={FAMILY_BULLETIN_RESIDENT_LOG_LOADING_MESSAGE}
        listLabel="Posted bulletin notes"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(FAMILY_BULLETIN_RESIDENT_LOG_LOADING_MESSAGE);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders a dated bulletin list instead of chat bubbles", () => {
    render(
      <FamilyPortalUpdateLog
        items={[
          {
            id: "note-1",
            body: "Physical therapy went well this morning.",
            timestamp: "Apr 8, 2026, 9:15 AM",
            authorLabel: "Care team",
            variant: "staff",
          },
        ]}
        listLabel="Posted updates"
      />,
    );

    expect(screen.getByRole("region", { name: /posted updates/i })).toBeInTheDocument();
    expect(screen.getByText(/physical therapy went well/i)).toBeInTheDocument();
    expect(screen.getByText(/care team/i)).toBeInTheDocument();
    expect(screen.queryByText(/start the conversation/i)).not.toBeInTheDocument();
  });
});
