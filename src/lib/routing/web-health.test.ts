// @vitest-environment node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LEGACY_REDIRECTS } from "./legacy-redirects";

async function runProbe(canonicalPublic = false, aliasDestination?: string) {
  const alias = LEGACY_REDIRECTS.find((redirect) => redirect.source === "/meds")!;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, "http://localhost").pathname;
    if (pathname === "/login" || (canonicalPublic && pathname === alias.destination)) {
      response.writeHead(200).end("Sign in");
    } else if (pathname === alias.source) {
      response.writeHead(alias.permanent ? 308 : 307, {
        location: aliasDestination ?? alias.destination,
      }).end();
    } else {
      response.writeHead(307, { location: `/login?next=${encodeURIComponent(pathname)}` }).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");

  try {
    return await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve("scripts/demo/web-health.mjs")], {
        env: { ...process.env, BASE_URL: `http://127.0.0.1:${address.port}` },
      });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("web-health medication alias (COL-826)", () => {
  it("accepts the configured alias and independently checks canonical authentication", async () => {
    const result = await runProbe();
    const report = JSON.parse(result.output);
    expect(report.unauthenticated_redirects["/meds"]).toMatchObject({
      pass: true, status: 308, location: "/caregiver/meds",
    });
    expect(report.unauthenticated_redirects["/caregiver/meds"]).toMatchObject({
      pass: true, status: 307, location: "/login?next=%2Fcaregiver%2Fmeds",
    });
    expect(report.summary).toEqual({ total_probes: 14, passed: 14, failed: 0 });
    expect(result.code).toBe(0);
  });

  it("fails when the canonical route is public even if the alias is correct", async () => {
    const result = await runProbe(true);
    const report = JSON.parse(result.output);
    expect(report.unauthenticated_redirects["/meds"].pass).toBe(true);
    expect(report.unauthenticated_redirects["/caregiver/meds"]).toMatchObject({ pass: false, status: 200 });
    expect(report.verdict.pass).toBe(false);
    expect(result.code).toBe(1);
  });

  it("fails when the alias points elsewhere even if the canonical route is protected", async () => {
    const result = await runProbe(false, "/caregiver/tasks");
    const report = JSON.parse(result.output);
    expect(report.unauthenticated_redirects["/meds"].pass).toBe(false);
    expect(report.unauthenticated_redirects["/caregiver/meds"].pass).toBe(true);
    expect(report.verdict.pass).toBe(false);
    expect(result.code).toBe(1);
  });
});
