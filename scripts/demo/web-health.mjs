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

const REDIRECT_PROBES = [
  { path: "/admin/residents", expected: "/login?next=%2Fadmin%2Fresidents", shell: "admin" },
  { path: "/admin/billing", expected: "/login?next=%2Fadmin%2Fbilling", shell: "admin" },
  { path: "/admin/staff", expected: "/login?next=%2Fadmin%2Fstaff", shell: "admin" },
  { path: "/admin/incidents", expected: "/login?next=%2Fadmin%2Fincidents", shell: "admin" },
  { path: "/admin/executive", expected: "/login?next=%2Fadmin%2Fexecutive", shell: "admin" },
  // Short aliases /finance and /vendors 308 to /admin/*; probe canonical paths (same auth as other admin shells).
  { path: "/admin/finance", expected: "/login?next=%2Fadmin%2Ffinance", shell: "admin" },
  { path: "/admin/vendors", expected: "/login?next=%2Fadmin%2Fvendors", shell: "admin" },
  { path: "/caregiver", expected: "/login?next=%2Fcaregiver", shell: "caregiver" },
  { path: "/caregiver/tasks", expected: "/login?next=%2Fcaregiver%2Ftasks", shell: "caregiver" },
  { path: "/caregiver/meds", expected: "/login?next=%2Fcaregiver%2Fmeds", shell: "caregiver" },
  { path: "/meds", expected: "/login?next=%2Fmeds", shell: "caregiver" },
  { path: "/family", expected: "/login?next=%2Ffamily", shell: "family" },
  { path: "/family/billing", expected: "/login?next=%2Ffamily%2Fbilling", shell: "family" },
  { path: "/family/messages", expected: "/login?next=%2Ffamily%2Fmessages", shell: "family" },
];

async function main() {
  const login = await request("/login");

  const redirectResults = {};
  let allRedirectsPass = true;

  for (const probe of REDIRECT_PROBES) {
    const result = await request(probe.path);
    const pass = expectRedirect(result, probe.expected);
    if (!pass) allRedirectsPass = false;
    redirectResults[probe.path] = {
      pass,
      shell: probe.shell,
      status: result.status,
      location: result.location,
    };
  }

  const loginPass =
    login.status === 200 &&
    ((login.body?.toLowerCase().includes("sign in") ?? false) ||
      (login.body?.toLowerCase().includes("haven access") ?? false));

  const output = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    login_page: {
      pass: loginPass,
      status: login.status,
    },
    unauthenticated_redirects: redirectResults,
    summary: {
      total_probes: REDIRECT_PROBES.length,
      passed: Object.values(redirectResults).filter((r) => r.pass).length,
      failed: Object.values(redirectResults).filter((r) => !r.pass).length,
    },
  };

  const verdict = loginPass && allRedirectsPass;

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
