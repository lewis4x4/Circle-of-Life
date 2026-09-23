import { describe, expect, it } from "vitest";

import {
  KB_NOT_IN_REVIEW_COPY,
  knowledgeReviewDueLabel,
  knowledgeReviewOwnerLabel,
} from "./review-queue-display-copy";

describe("knowledge review-queue labels (COL-649)", () => {
  it("does not call a published document Unassigned", () => {
    expect(knowledgeReviewOwnerLabel({ status: "published", review_owner: null }, "u1")).toBe(KB_NOT_IN_REVIEW_COPY);
    expect(knowledgeReviewDueLabel({ status: "published", review_due_at: null })).toBeNull();
  });

  it("labels documents in review", () => {
    expect(knowledgeReviewOwnerLabel({ status: "pending_review", review_owner: null }, "u1")).toBe("Unassigned");
    expect(knowledgeReviewOwnerLabel({ status: "pending_review", review_owner: "u1" }, "u1")).toBe("You");
    expect(knowledgeReviewOwnerLabel({ status: "pending_review", review_owner: "u2" }, "u1")).toBe("Assigned");
    expect(knowledgeReviewDueLabel({ status: "pending_review", review_due_at: null })).toBe("No due date");
  });
});
