#!/usr/bin/env node
import process from "node:process";
import { DEFAULT_VAULT_PATH, validateVault } from "./lib/vault-compiler.mjs";

const vaultPath = process.env.OBSIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH;
const output = validateVault(vaultPath);

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
