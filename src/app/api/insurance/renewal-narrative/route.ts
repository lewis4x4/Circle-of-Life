import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { noStoreJson, withNoStore } from "@/lib/insurance/workspace-server";

/** Historical packages remain readable; new narratives belong to versioned reviews. */
export async function POST() {
  const result = await requireCurrentApiActor({
    allowedRoles: ["owner", "org_admin"],
    scope: "insurance.renewal-narrative",
  });
  if ("response" in result) return withNoStore(result.response);
  return noStoreJson(
    {
      error:
        "Create a reviewed renewal package in Insurance servicing. Historical packages are available as read-only records.",
      replacement: "/admin/insurance/servicing?kind=renewal_package",
    },
    410,
  );
}
