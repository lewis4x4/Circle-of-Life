#!/usr/bin/env node
/**
 * Fail if .env.example contains JWT-shaped or other high-risk secret placeholders.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const file = path.join(root, ".env.example");

function fail(msg) {
  console.error(`[check:env-example] FAIL: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(file)) {
  fail(".env.example is missing");
}

const text = fs.readFileSync(file, "utf8");
const lines = text.split(/\r?\n/);

// JWT-like: three base64url-ish segments
const jwtLike =
  /(^|[=\s])(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/;
// Obvious service role / API key shapes
const risky =
  /(sk_live_[a-zA-Z0-9]{20,}|SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^#\s][^\n]{40,})/i;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^\s*#/.test(line)) continue;
  if (jwtLike.test(line)) {
    fail(`line ${i + 1}: JWT-shaped value — use plain placeholders (e.g. your_anon_key_here)`);
  }
  if (risky.test(line)) {
    fail(`line ${i + 1}: possible live secret pattern — use placeholders only`);
  }
}

console.log("[check:env-example] PASS");
process.exit(0);
