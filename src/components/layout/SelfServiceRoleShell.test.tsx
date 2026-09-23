import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SelfServiceRoleShell, selfServiceShellFor } from "@/components/layout/SelfServiceRoleShell";
import { isHousekeeperAllowedPath } from "@/lib/auth/caregiver-route-access";

const auth = vi.hoisted(() => ({ appRole: "", loading: false, user: null as null | { app_metadata: Record<string, unknown> } }));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div data-shell="admin">{children}</div> }));
vi.mock("@/components/layout/CaregiverShell", () => ({ CaregiverShell: ({ children }: { children: React.ReactNode }) => <div data-shell="floor">{children}</div> }));
vi.mock("@/components/layout/DietaryShell", () => ({ DietaryShell: ({ children }: { children: React.ReactNode }) => <div data-shell="kitchen">{children}</div> }));
vi.mock("@/components/layout/MedTechShell", () => ({ MedTechShell: ({ children }: { children: React.ReactNode }) => <div data-shell="med-tech">{children}</div> }));

describe("self-service pages mount the signed-in role's shell (COL-654)", () => {
  beforeEach(() => {
    auth.appRole = "";
    auth.loading = false;
    auth.user = null;
  });

  it.each([
    ["med_tech", "med-tech"],
    ["cook", "kitchen"],
    ["housekeeper", "floor"],
    ["owner", "admin"],
    ["facility_admin", "admin"],
  ])("%s -> %s shell", (role, shell) => {
    expect(selfServiceShellFor(role)).toBe(shell);
    auth.appRole = role;
    const { container } = render(<SelfServiceRoleShell><p>My employee file</p></SelfServiceRoleShell>);
    expect(container.querySelector(`[data-shell="${shell}"]`)?.textContent).toBe("My employee file");
  });

  it("waits for the role instead of rendering the page bare", () => {
    auth.loading = true;
    render(<SelfServiceRoleShell><p>My employee file</p></SelfServiceRoleShell>);
    expect(screen.queryByText("My employee file")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("lets housekeepers stay on their employee file inside the floor shell", () => {
    expect(isHousekeeperAllowedPath("/employee-file")).toBe(true);
    expect(isHousekeeperAllowedPath("/employee-file/reviews")).toBe(true);
  });

  it("the employee-file route mounts it", () => {
    const layout = fs.readFileSync(path.resolve(__dirname, "../../app/employee-file/layout.tsx"), "utf8");
    expect(layout).toContain("<SelfServiceRoleShell>");
    expect(layout).toContain("AppRuntimeProviders");
  });
});
