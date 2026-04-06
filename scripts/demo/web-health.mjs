#!/usr/bin/env node
import process from "node:process";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";

async function request(pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    ...init,
  });

  return {
    status: response.status,
    location: response.headers.get("location"),
    body: init.method === "HEAD" ? null : await response.text(),
  };
}

function expectRedirect(result, expectedLocation) {
  return (
    result.status >= 300 &&
    result.status < 400 &&
    typeof result.location === "string" &&
    result.location.includes(expectedLocation)
  );
}

async function main() {
  const login = await request("/login");
  const adminResidents = await request("/admin/residents");
  const caregiver = await request("/caregiver");
  const family = await request("/family");

  const output = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    login_page: {
      pass:
        login.status === 200 &&
        ((login.body?.toLowerCase().includes("sign in") ?? false) ||
          (login.body?.toLowerCase().includes("haven access") ?? false)),
      status: login.status,
    },
    unauthenticated_redirects: {
      admin_residents: {
        pass: expectRedirect(adminResidents, "/login?next=%2Fadmin%2Fresidents"),
        status: adminResidents.status,
        location: adminResidents.location,
      },
      caregiver: {
        pass: expectRedirect(caregiver, "/login?next=%2Fcaregiver"),
        status: caregiver.status,
        location: caregiver.location,
      },
      family: {
        pass: expectRedirect(family, "/login?next=%2Ffamily"),
        status: family.status,
        location: family.location,
      },
    },
  };

  const verdict =
    output.login_page.pass &&
    output.unauthenticated_redirects.admin_residents.pass &&
    output.unauthenticated_redirects.caregiver.pass &&
    output.unauthenticated_redirects.family.pass;

  console.log(
    JSON.stringify(
      {
        ...output,
        verdict: {
          pass: verdict,
        },
      },
      null,
      2,
    ),
  );

  process.exit(verdict ? 0 : 1);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        base_url: baseUrl,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
