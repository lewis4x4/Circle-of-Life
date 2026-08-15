import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FAMILY_HOME_BULLETIN_EMPTY_TITLE,
  FAMILY_HOME_BULLETIN_HELPER,
} from "@/lib/family/family-portal-copy";
import type { FamilyFeedNoteItem } from "@/lib/family/family-feed";

import { FamilyHomeBulletinBar } from "./FamilyHomeBulletinBar";

const sampleNote: FamilyFeedNoteItem = {
  kind: "note",
  id: "note-1",
  sortAt: "2026-08-10T15:30:00.000Z",
  residentId: "resident-1",
  residentName: "Your loved one",
  title: "Care team update",
  body: "Physical therapy went well this morning.",
  detail: "Physical therapy went well this morning.",
  timeLabel: "Aug 10, 3:30 PM",
  badge: "Update",
  href: "/family/messages",
};

describe("<FamilyHomeBulletinBar />", () => {
  it("shows calm bulletin empty copy without chat or reply affordances", () => {
    render(<FamilyHomeBulletinBar featuredNote={null} />);

    expect(screen.getByRole("region", { name: /care team bulletin/i })).toBeInTheDocument();
    expect(screen.getByText(FAMILY_HOME_BULLETIN_HELPER)).toBeInTheDocument();
    expect(screen.getByText(FAMILY_HOME_BULLETIN_EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/when the care team posts an update/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send|reply/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/start the conversation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/journal is quiet/i)).not.toBeInTheDocument();
  });

  it("shows the latest note and last posted timestamp when a bulletin exists", () => {
    render(<FamilyHomeBulletinBar featuredNote={sampleNote} />);

    expect(screen.getByText(/physical therapy went well/i)).toBeInTheDocument();
    expect(screen.getByText(/last posted/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all updates/i })).toHaveAttribute(
      "href",
      "/family/messages",
    );
    expect(screen.queryByText(FAMILY_HOME_BULLETIN_EMPTY_TITLE)).not.toBeInTheDocument();
  });
});
