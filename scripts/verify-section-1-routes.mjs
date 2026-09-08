import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeAppPath } from "next/dist/shared/lib/router/utils/app-paths.js";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination.js";

export const repairedRoutes = [
  "finance/forecast",
  "finance/close",
  "finance/trust",
  "reports/history/[id]",
  "training/inservice/new",
  "transportation/requests/new",
  "transportation/requests/[id]",
];

export function resolveRedirect(redirects, pathname) {
  for (const redirect of redirects) {
    const params = getPathMatch(redirect.source)(pathname);
    if (params) {
      return prepareDestination({
        destination: redirect.destination,
        params,
        query: {},
        appendParamsToQuery: false,
      }).newUrl;
    }
  }
  return null;
}

/** Run after the production build: require both compiled modules and router registration. */
export function verifyBuiltCanonicalAdminRoutes(buildDir = path.resolve(".next")) {
  const appPaths = JSON.parse(readFileSync(path.join(buildDir, "server/app-paths-manifest.json"), "utf8"));
  const routes = JSON.parse(readFileSync(path.join(buildDir, "routes-manifest.json"), "utf8"));
  for (const route of repairedRoutes) {
    const canonical = `/admin/${route}`;
    const sample = canonical.replace("[id]", "section-1-record");
    const modules = Object.keys(appPaths).filter((key) => normalizeAppPath(key) === canonical);
    assert.equal(modules.length, 1, `${canonical}: expected one canonical page module`);
    assert.ok(existsSync(path.join(buildDir, "server", appPaths[modules[0]])), `${canonical}: compiled module missing`);
    const registration = [...routes.staticRoutes, ...routes.dynamicRoutes].find((item) => item.page === canonical);
    assert.ok(registration, `${canonical}: missing from production route manifest`);
    assert.ok(new RegExp(registration.regex).test(sample), `${canonical}: compiled route does not match destination`);
    assert.equal(resolveRedirect(routes.redirects, sample.replace(/^\/admin/, "")), sample, `${canonical}: legacy redirect gap`);
    assert.equal(resolveRedirect(routes.redirects, sample), null, `${canonical}: unexpected second redirect`);
  }
  return repairedRoutes.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const count = verifyBuiltCanonicalAdminRoutes(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`PASS: ${count} canonical modules, compiled route registrations, and legacy redirect destinations.`);
}
