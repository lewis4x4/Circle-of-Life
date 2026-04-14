#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { compileVault, DEFAULT_VAULT_PATH } from "./lib/vault-compiler.mjs";

const vaultPath = process.env.OBSIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH;
const outputPath =
  process.env.OBSIDIAN_MANIFEST_PATH ??
  path.join(process.cwd(), ".omx", "state", "obsidian", "vault-manifest.json");

const manifest = compileVault(vaultPath);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      vault_path: vaultPath,
      output_path: outputPath,
      summary: manifest.summary,
    },
    null,
    2,
  ),
);
