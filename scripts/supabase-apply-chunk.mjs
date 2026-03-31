#!/usr/bin/env node
/**
 * Reads a migration SQL file, minifies whitespace, prints JSON for MCP apply_migration.
 * Usage: node scripts/supabase-apply-chunk.mjs <migration_name_snake> <path/to/file.sql>
 */
import fs from "node:fs";

const name = process.argv[2];
const file = process.argv[3];
if (!name || !file) {
  console.error("Usage: node scripts/supabase-apply-chunk.mjs <migration_name> <file.sql>");
  process.exit(1);
}
const query = fs.readFileSync(file, "utf8").replace(/\s+/g, " ").trim();
process.stdout.write(JSON.stringify({ name, query }));
