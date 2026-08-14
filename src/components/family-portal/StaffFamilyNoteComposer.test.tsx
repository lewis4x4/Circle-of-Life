import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StaffFamilyNoteComposer } from "./StaffFamilyNoteComposer";

function ComposerHarness({ onPost }: { onPost: () => void }) {
  const [draft, setDraft] = useState("");
  return (
    <StaffFamilyNoteComposer
      draft={draft}
      deliveryMethod="portal_only"
      onDraftChange={setDraft}
      onDeliveryMethodChange={() => {}}
      onPost={onPost}
    />
  );
}

describe("<StaffFamilyNoteComposer />", () => {
  it("posts a note when staff submits the form", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn();

    render(<ComposerHarness onPost={onPost} />);

    const postButton = screen.getByRole("button", { name: /post update/i });
    expect(postButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/write an update for the family portal/i);
    await user.type(textarea, "Dinner went well today.");

    expect(postButton).not.toBeDisabled();
    await user.click(postButton);
    expect(onPost).toHaveBeenCalledTimes(1);
  });

  it("uses bulletin copy instead of reply or send language", () => {
    render(
      <StaffFamilyNoteComposer
        draft=""
        deliveryMethod="portal_only"
        onDraftChange={() => {}}
        onDeliveryMethodChange={() => {}}
        onPost={() => {}}
      />,
    );

    expect(screen.getByText(/post an update/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /post update/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/type a reply/i)).not.toBeInTheDocument();
  });
});
