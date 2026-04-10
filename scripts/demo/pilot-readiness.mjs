#!/usr/bin/env node
/**
 * Bundled local Track A probes (app should be running for web-* steps).
 *
 * Optional: set PILOT_READINESS_AUTH_SMOKE_REAL=1 to also run
 * `scripts/demo/authenticated-smoke.mjs` (Playwright — owner + facility_admin +
 * caregiver + family; PH1-A04 / PH1-P04). Requires dev server / BASE_URL reachable.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const includeAuthSmokeReal = process.env.PILOT_READINESS_AUTH_SMOKE_REAL === "1";

function run(label, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    /* not JSON — keep raw */
  }

  return {
    label,
    exit_code: result.status ?? 1,
    pass: result.status === 0,
    result: json,
    stderr: result.stderr?.trim() || null,
  };
}

const steps = [
  run("web-health", "node", ["scripts/demo/web-health.mjs"], { BASE_URL: baseUrl }),
  run("auth-smoke", "node", ["scripts/demo/auth-smoke.mjs"], { BASE_URL: baseUrl }),
  run("auth-check", "node", ["scripts/demo/check-auth-diagnostics.mjs"]),
  run("ops-status", "node", ["scripts/demo/phase1-ops-status.mjs"]),
];

if (includeAuthSmokeReal) {
  steps.push(
    run("auth-smoke-real", "node", ["scripts/demo/authenticated-smoke.mjs"], {
      BASE_URL: baseUrl,
    }),
  );
}

const authSmokeRealStep = steps.find((s) => s.label === "auth-smoke-real");

const output = {
  checked_at: new Date().toISOString(),
  base_url: baseUrl,
  pilot_readiness_auth_smoke_real: includeAuthSmokeReal,
  steps: steps.map(({ label, pass, exit_code, result }) => ({
    label,
    pass,
    exit_code,
    verdict: result?.verdict ?? null,
  })),
  verdict: {
    web_health: steps[0].pass,
    auth_smoke: steps[1].pass,
    auth_check_settings_ok: steps[2].result?.settings?.ok ?? false,
    pilot_login_ok: steps[2].result?.verdict?.pilot_login_ok ?? false,
    ops_migrations_aligned: steps[3].result?.verdict?.remote_alignment_ok ?? false,
    ops_functions_ok: steps[3].result?.verdict?.functions_ok ?? false,
    auth_smoke_real_ok: authSmokeRealStep ? authSmokeRealStep.pass : null,
    all_local_pass: steps[0].pass && steps[1].pass,
    all_pass: steps.every((s) => s.pass),
  },
};

console.log(JSON.stringify(output, null, 2));

const localPass =
  output.verdict.all_local_pass &&
  (authSmokeRealStep === undefined || authSmokeRealStep.pass);

process.exit(localPass ? 0 : 1);
