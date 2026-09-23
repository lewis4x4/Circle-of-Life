/**
 * COL-661 A3: /caregiver/housekeeper loads its tasks from
 * /api/admin/operations/tasks, which refuses roles outside
 * OPERATIONS_VIEW_ROLES with 403 "Insufficient role". A role the floor shell
 * admits to the page must therefore be able to view operations; otherwise it
 * should be redirected, not left to load and fail.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { caregiverShellAccessRedirect } from "@/lib/auth/caregiver-shell";
import { isOperationsViewRole } from "@/lib/operations/constants";
import { ALL_APP_ROLES } from "@/lib/rbac";

const admitted = (role: string) =>
  caregiverShellAccessRedirect(new NextRequest(new URL("https://haven.test/caregiver/housekeeper")), {
    app_metadata: { app_role: role },
  }) === null;

describe("housekeeper dashboard access matches the tasks API", () => {
  it.each([...ALL_APP_ROLES])("%s is either redirected or can read operations tasks", (role) => {
    if (admitted(role)) expect(isOperationsViewRole(role)).toBe(true);
  });

  it("admits the housekeeper, whose home it is", () => {
    expect(admitted("housekeeper")).toBe(true);
  });
});
