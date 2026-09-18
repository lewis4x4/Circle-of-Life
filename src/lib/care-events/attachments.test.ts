import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_INCIDENT,
  ATTACHMENT_MIME_TYPES,
  ATTACHMENT_URL_TTL_SECONDS,
  attachmentKindLabel,
  describeAttachmentError,
  describeAttachmentRejection,
  isAttachmentKind,
} from "./attachments";

describe("the limits", () => {
  it("signs for five minutes and never longer", () => {
    expect(ATTACHMENT_URL_TTL_SECONDS).toBe(300);
  });

  it("stops at 20 MB and ten files per incident", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(20971520);
    expect(ATTACHMENT_MAX_PER_INCIDENT).toBe(10);
  });

  it("accepts images and PDF, and nothing that executes", () => {
    expect([...ATTACHMENT_MIME_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ]);
    expect(ATTACHMENT_ACCEPT).toContain("application/pdf");
    expect(ATTACHMENT_ACCEPT).not.toContain("text/html");
    expect(ATTACHMENT_ACCEPT).not.toContain("*/*");
  });
});

describe("attachment kinds", () => {
  it("names the four the paper process produces", () => {
    expect(attachmentKindLabel("photo")).toBe("Photo");
    expect(attachmentKindLabel("scanned_form")).toBe("Scanned form");
    expect(attachmentKindLabel("physician_order")).toBe("Physician order");
    expect(attachmentKindLabel("other")).toBe("Other");
  });

  it("never renders a raw stored value", () => {
    expect(attachmentKindLabel("something_new")).toBe("Other");
    expect(attachmentKindLabel(null)).toBe("Other");
  });

  it("recognises only the four", () => {
    expect(isAttachmentKind("physician_order")).toBe(true);
    expect(isAttachmentKind("xray")).toBe(false);
    expect(isAttachmentKind(undefined)).toBe(false);
  });
});

describe("describeAttachmentRejection", () => {
  const jpeg = { type: "image/jpeg", size: 1024 };

  it("passes an ordinary photo", () => {
    expect(describeAttachmentRejection(jpeg, 0)).toBeNull();
  });

  it("passes a PDF, which is how a scanned form and a faxed order arrive", () => {
    expect(describeAttachmentRejection({ type: "application/pdf", size: 4096 }, 3)).toBeNull();
  });

  it("refuses an eleventh file", () => {
    expect(describeAttachmentRejection(jpeg, 10)).toContain("Ten files is the limit");
    expect(describeAttachmentRejection(jpeg, 9)).toBeNull();
  });

  it("refuses a file over 20 MB before the upload starts", () => {
    expect(describeAttachmentRejection({ type: "image/jpeg", size: ATTACHMENT_MAX_BYTES + 1 }, 0)).toContain("larger than 20 MB");
    expect(describeAttachmentRejection({ type: "image/jpeg", size: ATTACHMENT_MAX_BYTES }, 0)).toBeNull();
  });

  it("refuses a type the bucket would refuse anyway", () => {
    expect(describeAttachmentRejection({ type: "text/html", size: 10 }, 0)).toContain("not accepted");
    expect(describeAttachmentRejection({ type: "application/zip", size: 10 }, 0)).toContain("not accepted");
  });

  it("lets an unknown type through to the bucket, because a HEIC can arrive with none", () => {
    expect(describeAttachmentRejection({ type: "", size: 2048 }, 0)).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(describeAttachmentRejection({ type: "image/jpeg", size: 0 }, 0)).toBe("That file is empty.");
  });

  it("checks the count before the size, so the cap is the reason given at the cap", () => {
    expect(describeAttachmentRejection({ type: "image/jpeg", size: ATTACHMENT_MAX_BYTES + 1 }, 10)).toContain("Ten files is the limit");
  });
});

describe("describeAttachmentError", () => {
  it("turns each refusal into a line an aide can act on", () => {
    expect(describeAttachmentError(new Error("care_event: ten files is the limit for one incident"))).toBe(
      "Ten files is the limit for one incident.",
    );
    expect(describeAttachmentError(new Error("care_event: that file is already attached"))).toBe("That file is already attached.");
    expect(describeAttachmentError(new Error("care_event: unknown attachment kind"))).toBe("Pick what the file is before adding it.");
    expect(describeAttachmentError(new Error("The object exceeded the maximum allowed size"))).toBe("That file is larger than 20 MB.");
    expect(describeAttachmentError(new Error("mime type text/html is not supported"))).toBe(
      "That file type is not accepted. Use a photo or a PDF.",
    );
    expect(describeAttachmentError(new Error("care_event: forbidden"))).toBe("That is not yours to add.");
  });

  it("says the event is still saved when the file is the only thing that failed", () => {
    expect(describeAttachmentError(new Error("network error"))).toBe(
      "The file did not upload. The event is saved; try the file again.",
    );
  });
});
