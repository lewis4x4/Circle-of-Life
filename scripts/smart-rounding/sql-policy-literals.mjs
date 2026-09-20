#!/usr/bin/env node
/** Scan effective Smart Rounding function definitions, not migration seed rows. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MODULE_FUNCTION = /(?:observation|cadence|monitoring|watchlist|escalation)/i;
const COMMENT = /--[^\n]*|\/\*[\s\S]*?\*\//g;

const IDENTIFIER = String.raw`(?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))?`;

function signature(sql, start, parametersHaveNames = true) {
  let depth = 1;
  let quoted = false;
  let item = "";
  const items = [];
  let end = start;
  for (; end < sql.length; end++) {
    const char = sql[end];
    if (char === "'") {
      if (quoted && sql[end + 1] === "'") { item += "''"; end++; continue; }
      quoted = !quoted;
    }
    if (!quoted) {
      if (char === "(" || char === "[") depth++;
      if (char === ")" || char === "]") depth--;
      if (depth === 0) { items.push(item); break; }
      if (char === "," && depth === 1) { items.push(item); item = ""; continue; }
    }
    item += char;
  }
  if (depth !== 0) throw new Error("Unterminated SQL function signature");
  const types = items.map((parameter) => {
    let value = parameter.trim().replace(/\s+(?:DEFAULT|=)\s*[\s\S]*$/i, "");
    if (/^OUT\b/i.test(value)) return null;
    value = value.replace(/^(?:IN|INOUT|VARIADIC)\s+/i, "");
    if (parametersHaveNames && /^(?:p_|v_|_)/i.test(value)) value = value.replace(/^\S+\s+/, "");
    return value.toLowerCase().replaceAll('"', "").replace(/^public\./, "")
      .replace(/\bint4\b|\bint\b/g, "integer").replace(/\bbool\b/g, "boolean")
      .replace(/timestamp with time zone/g, "timestamptz").replace(/\s+/g, " ").trim();
  }).filter(Boolean);
  return { key: types.join(","), end };
}

export function functionBodies(sql, file = "input.sql") {
  const definitions = [];
  const header = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(${IDENTIFIER})\s*\(`, "gi");
  for (const match of sql.matchAll(header)) {
    const name = match[1].replaceAll('"', "").toLowerCase();
    const args = signature(sql, match.index + match[0].length);
    const tail = sql.slice(args.end + 1);
    const bodyStart = /\bAS\s+(\$\w*\$|'(?:''|[^'])*')/i.exec(tail);
    const nextDefinition = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i.exec(tail);
    if (!bodyStart || (nextDefinition && nextDefinition.index < bodyStart.index)) {
      if (MODULE_FUNCTION.test(name)) throw new Error(`Unsupported module function body: ${file} ${name}`);
      continue;
    }
    const start = args.end + 1 + bodyStart.index + bodyStart[0].length;
    let body;
    if (bodyStart[1].startsWith("'")) body = bodyStart[1].slice(1, -1).replaceAll("''", "'");
    else {
      const end = sql.indexOf(bodyStart[1], start);
      if (end < 0) throw new Error(`Unterminated function body: ${file} ${name}`);
      body = sql.slice(start, end);
    }
    definitions.push({ name, signature: args.key, offset: match.index, file, body, line: sql.slice(0, start).split("\n").length });
  }
  return definitions;
}

export function effectiveBodies(sources) {
  const latest = new Map();
  const drop = new RegExp(String.raw`DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(${IDENTIFIER})\s*\(`, "gi");
  for (const { file, sql } of sources) {
    const events = functionBodies(sql, file).map((definition) => ({ ...definition, drop: false }));
    for (const match of sql.matchAll(drop)) {
      const args = signature(sql, match.index + match[0].length, false);
      events.push({ name: match[1].replaceAll('"', "").toLowerCase(), signature: args.key, offset: match.index, drop: true });
    }
    for (const event of events.sort((a, b) => a.offset - b.offset)) {
      if (!MODULE_FUNCTION.test(event.name)) continue;
      const key = `${event.name}(${event.signature})`;
      if (event.drop) latest.delete(key); else latest.set(key, event);
    }
  }
  return [...latest.values()];
}

export function policyFindings(definition) {
  // Retry lease duration is transport recovery, not an observation policy.
  if (definition.name === "haven.observation_delivery_claim_timeout") return [];
  const body = definition.body.replace(COMMENT, (comment) => comment.replace(/[^\n]/g, " "));
  const findings = [];
  const rules = [
    ["window or shift time", /(?<!\w)(?:TIME\s*'[0-2]?\d:[0-5]\d(?::[0-5]\d)?'|'[0-2]?\d:[0-5]\d(?::[0-5]\d)?'\s*::\s*time)(?=\W|$)/gi],
    ["policy duration", /\binterval\s*'\s*\d+(?:\.\d+)?\s*(?:minute|hour)s?\s*'/gi],
    ["policy assignment", /\b\w*(?:grace|offset|nudge)\w*\s*(?::=|DEFAULT|=)\s*-?\d+(?:\.\d+)?\b/gi],
    ["fixed shift", /\b(?:\w+\.)?shift_key\s*=\s*'(?:day|night|evening)'/gi],
  ];
  for (const [kind, expression] of rules) {
    for (const match of body.matchAll(expression)) {
      findings.push({ file: definition.file, function: definition.name, line: definition.line + body.slice(0, match.index).split("\n").length - 1, kind, value: match[0] });
    }
  }
  return findings;
}

export function scanSqlPolicy(directory) {
  const definitions = effectiveBodies(fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort().map((file) => ({
    file, sql: fs.readFileSync(path.join(directory, file), "utf8"),
  })));
  return { checked: definitions.length, findings: definitions.flatMap(policyFindings) };
}

function main() {
  const result = scanSqlPolicy(path.resolve("supabase/migrations"));
  console.log(`[sql-policy-literals] Checked ${result.checked} effective module function bodies; seed DML is excluded.`);
  console.log("[sql-policy-literals] Explicit exception: observation_delivery_claim_timeout is a transport lease, not cadence.");
  for (const finding of result.findings) console.error(`${finding.file}:${finding.line} ${finding.function}: ${finding.kind}: ${finding.value}`);
  console.log(`[sql-policy-literals] ${result.findings.length ? "FAIL" : "PASS"}`);
  process.exitCode = result.findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
