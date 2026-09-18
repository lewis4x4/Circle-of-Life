import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CareEventAttachment } from "@/lib/care-events/attachments";

const fetchCareEventAttachments = vi.fn();
const uploadCareEventAttachment = vi.fn();
const signAttachment = vi.fn();

vi.mock("@/lib/care-events/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/care-events/attachments")>();
  return {
    ...actual,
    fetchCareEventAttachments: (...args: unknown[]) => fetchCareEventAttachments(...args),
    uploadCareEventAttachment: (...args: unknown[]) => uploadCareEventAttachment(...args),
    signAttachment: (...args: unknown[]) => signAttachment(...args),
  };
});

const { CareEventAttachments } = await import("./CareEventAttachments");

const openSpy = vi.fn();

afterEach(() => {
  cleanup();
  for (const spy of [fetchCareEventAttachments, uploadCareEventAttachment, signAttachment, openSpy]) spy.mockReset();
});

vi.stubGlobal("open", (...args: unknown[]) => openSpy(...args));

const props = {
  supabase: {} as never,
  careEventId: "care-event-1",
  organizationId: "org-1",
  facilityId: "facility-1",
  timeZone: "America/New_York",
  canUpload: true,
};

function row(overrides: Partial<CareEventAttachment> = {}): CareEventAttachment {
  return {
    id: "attachment-1",
    path: "org-1/facility-1/care-event-1/a.jpg",
    kind: "photo",
    description: null,
    takenAt: "2026-09-16T23:04:00Z",
    takenByName: "Staff A",
    ...overrides,
  };
}

function pdf(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

describe("CareEventAttachments", () => {
  it("lists each file with its kind and who added it", async () => {
    fetchCareEventAttachments.mockResolvedValue([
      row(),
      row({ id: "attachment-2", path: "org-1/facility-1/care-event-1/b.pdf", kind: "physician_order", takenByName: "Staff B" }),
    ]);
    render(<CareEventAttachments {...props} />);

    expect(await screen.findByRole("button", { name: "Open the photo added by Staff A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the physician order added by Staff B" })).toBeInTheDocument();
    expect(screen.getByText(/Staff A/)).toBeInTheDocument();
    expect(screen.getByText(/Staff B/)).toBeInTheDocument();
    // No raw stored value on screen.
    expect(screen.queryByText(/physician_order/)).not.toBeInTheDocument();
  });

  it("says so plainly when there are no files", async () => {
    fetchCareEventAttachments.mockResolvedValue([]);
    render(<CareEventAttachments {...props} />);
    expect(await screen.findByText("No files yet.")).toBeInTheDocument();
  });

  it("opens a file through a signed URL and never a public one", async () => {
    const user = userEvent.setup();
    fetchCareEventAttachments.mockResolvedValue([row()]);
    signAttachment.mockResolvedValue("https://example.invalid/signed?token=abc&expires=300");
    render(<CareEventAttachments {...props} />);

    await user.click(await screen.findByRole("button", { name: "Open the photo added by Staff A" }));

    await waitFor(() => expect(signAttachment).toHaveBeenCalledTimes(1));
    expect(signAttachment.mock.calls[0]?.[1]).toBe("org-1/facility-1/care-event-1/a.jpg");
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.invalid/signed?token=abc&expires=300",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("says so when the signed URL could not be made, and opens nothing", async () => {
    const user = userEvent.setup();
    fetchCareEventAttachments.mockResolvedValue([row()]);
    signAttachment.mockResolvedValue(null);
    render(<CareEventAttachments {...props} />);

    await user.click(await screen.findByRole("button", { name: "Open the photo added by Staff A" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That file could not be opened. Try again.");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("accepts images and PDF on the file input", async () => {
    fetchCareEventAttachments.mockResolvedValue([]);
    render(<CareEventAttachments {...props} />);
    const input = (await screen.findByLabelText("Choose a photo or PDF")) as HTMLInputElement;
    expect(input.accept).toContain("application/pdf");
    expect(input.accept).toContain("image/jpeg");
  });

  it("refuses an oversized file before uploading anything", async () => {
    const user = userEvent.setup();
    fetchCareEventAttachments.mockResolvedValue([]);
    render(<CareEventAttachments {...props} />);

    const input = (await screen.findByLabelText("Choose a photo or PDF")) as HTMLInputElement;
    await user.upload(input, pdf("big.pdf", 20 * 1024 * 1024 + 1));

    expect(await screen.findByRole("alert")).toHaveTextContent("larger than 20 MB");
    expect(uploadCareEventAttachment).not.toHaveBeenCalled();
  });

  it("stops offering the control once ten files are on the incident", async () => {
    fetchCareEventAttachments.mockResolvedValue(Array.from({ length: 10 }, (_, i) => row({ id: `attachment-${i}` })));
    render(<CareEventAttachments {...props} />);

    const button = await screen.findByRole("button", { name: /Ten files is the limit/ });
    expect(button).toBeDisabled();
  });

  it("uploads with the kind the operator picked", async () => {
    const user = userEvent.setup();
    fetchCareEventAttachments.mockResolvedValue([]);
    uploadCareEventAttachment.mockResolvedValue("org-1/facility-1/care-event-1/c.pdf");
    render(<CareEventAttachments {...props} />);

    await user.click(await screen.findByRole("button", { name: "Scanned form" }));
    const input = (await screen.findByLabelText("Choose a photo or PDF")) as HTMLInputElement;
    await user.upload(input, pdf("form.pdf", 512));

    await waitFor(() => expect(uploadCareEventAttachment).toHaveBeenCalledTimes(1));
    expect(uploadCareEventAttachment.mock.calls[0]?.[1]).toMatchObject({
      careEventId: "care-event-1",
      facilityId: "facility-1",
      organizationId: "org-1",
      kind: "scanned_form",
    });
  });

  it("offers only the kinds the caregiver receipt allows, and no picker when there is one", async () => {
    fetchCareEventAttachments.mockResolvedValue([]);
    render(<CareEventAttachments {...props} kinds={["photo"]} />);

    await screen.findByText("No files yet.");
    expect(screen.queryByRole("group", { name: "What is this file?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scanned form" })).not.toBeInTheDocument();
  });

  it("shows the list but no upload control to a role that may not add files", async () => {
    fetchCareEventAttachments.mockResolvedValue([row()]);
    render(<CareEventAttachments {...props} canUpload={false} />);

    expect(await screen.findByRole("button", { name: "Open the photo added by Staff A" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose a photo or PDF")).not.toBeInTheDocument();
  });

  it("reports the database refusal rather than pretending the file landed", async () => {
    const user = userEvent.setup();
    fetchCareEventAttachments.mockResolvedValue([]);
    uploadCareEventAttachment.mockRejectedValue(new Error("care_event: ten files is the limit for one incident"));
    render(<CareEventAttachments {...props} />);

    const input = (await screen.findByLabelText("Choose a photo or PDF")) as HTMLInputElement;
    await user.upload(input, pdf("form.pdf", 512));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ten files is the limit for one incident.");
  });
});
