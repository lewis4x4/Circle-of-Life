#!/usr/bin/env node
/**
 * COL-849: remove the Homewood test window's uploaded photos from Storage.
 *
 * Runbook: docs/operations/homewood-test-window.md. Run it on the evening of
 * 2026-09-30, BEFORE scripts/floor/homewood-test-window-wipe.sql: the wipe
 * refuses to delete the photo rows while their files are still in Storage, and
 * once the rows are gone nothing points at the files any more.
 *
 * What it removes: objects in bucket `incident-photos` under
 * `<Circle of Life org>/<Homewood>/` (the path shape attach_care_event_file
 * enforces: `<organization>/<facility>/<care event>/<file>`) whose Storage
 * created_at is at or after the window start, 2026-09-25 20:24:02.307103+00.
 * Nothing outside that prefix, nothing older. Removal goes through the Storage
 * API so the file bytes are deleted, not only the storage.objects rows.
 *
 * Production only, on purpose: it reads `.env.local` (the file that points at
 * production in Haven checkouts) and refuses unless the URL is
 * manfqmasfqppukpobpld. It prints paths (ids only) and counts, never keys.
 *
 *   node scripts/floor/homewood-test-window-photos.mjs           # dry run: lists what would go
 *   node scripts/floor/homewood-test-window-photos.mjs --apply   # removes them, then lists again
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const PREFIX = "[col849-photos]";
const PRODUCTION_REF = "manfqmasfqppukpobpld";
const BUCKET = "incident-photos";
const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const HOMEWOOD_ID = "00000000-0000-0000-0002-000000000003";
const WINDOW_START = Date.parse("2026-09-25T20:24:02.307Z");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = 100;

function log(message) {
  console.log(`${PREFIX} ${message}`);
}

function fail(message) {
  console.error(`${PREFIX} ${message}`);
  process.exit(1);
}

function loadProductionEnv() {
  const file = path.join(REPO_ROOT, ".env.local");
  if (!existsSync(file)) fail(".env.local is missing; it holds the production keys.");
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (new URL(url).hostname !== `${PRODUCTION_REF}.supabase.co`) {
    fail(`REFUSING: .env.local does not point at Haven production (${PRODUCTION_REF}).`);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) fail(".env.local has no SUPABASE_SERVICE_ROLE_KEY.");
  return { url, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

/** Every object one level below `folder`, following pages. */
async function listFolder(storage, folder) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.list(folder, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) fail(`Listing ${folder} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** The test window's photos: `<org>/<Homewood>/<care event>/<file>` created at or after the window start. */
async function windowPhotos(storage) {
  const root = `${ORGANIZATION_ID}/${HOMEWOOD_ID}`;
  const photos = [];
  for (const careEvent of await listFolder(storage, root)) {
    // A folder has no id in the Storage list API; a file directly under the facility would.
    if (careEvent.id) {
      const createdAt = Date.parse(careEvent.created_at ?? "");
      if (Number.isFinite(createdAt) && createdAt >= WINDOW_START) photos.push({ path: `${root}/${careEvent.name}`, createdAt });
      continue;
    }
    for (const file of await listFolder(storage, `${root}/${careEvent.name}`)) {
      if (!file.id) continue;
      const createdAt = Date.parse(file.created_at ?? "");
      if (!Number.isFinite(createdAt)) fail(`${root}/${careEvent.name}/${file.name} has no created_at; stopping rather than guessing.`);
      if (createdAt >= WINDOW_START) photos.push({ path: `${root}/${careEvent.name}/${file.name}`, createdAt });
    }
  }
  return photos.sort((a, b) => a.createdAt - b.createdAt);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadProductionEnv();
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const storage = admin.storage.from(BUCKET);

  log(`${apply ? "APPLY" : "DRY RUN (nothing is removed)"}; bucket ${BUCKET}; Homewood; created at or after ${new Date(WINDOW_START).toISOString()}`);
  const photos = await windowPhotos(storage);
  log(`${photos.length} test photo(s)`);
  for (const photo of photos) log(`  ${new Date(photo.createdAt).toISOString()}  ${photo.path}`);
  if (!apply || photos.length === 0) return;

  for (let i = 0; i < photos.length; i += PAGE) {
    const batch = photos.slice(i, i + PAGE).map((photo) => photo.path);
    const { error } = await storage.remove(batch);
    if (error) fail(`Removing photos failed after ${i} of ${photos.length}: ${error.message}`);
  }
  const left = await windowPhotos(storage);
  if (left.length > 0) fail(`${left.length} test photo(s) are still in Storage after the removal.`);
  log(`removed ${photos.length}; 0 test photos left. Next: the wipe dry run.`);
}

await main();
