#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function parseCsv(content) {
  const rows = [];
  let current = "";
  let row = [];
  let quoted = false;
  let closedQuote = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else if (quoted) {
        quoted = false;
        closedQuote = true;
      } else {
        if (current || closedQuote) throw new Error("CSV quote must begin a field.");
        quoted = true;
      }
      continue;
    }
    if (closedQuote && char !== "," && char !== "\n" && char !== "\r") throw new Error("Unexpected content after CSV closing quote.");

    if (char === "," && !quoted) {
      row.push(current);
      current = "";
      closedQuote = false;
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      closedQuote = false;
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  const header = rows.shift()?.map((cell) => cell.replace(/^\uFEFF/, "").trim());
  if (!header || !rows.length) throw new Error("CSV must contain a header and at least one data row.");
  if (new Set(header).size !== header.length || header.some((cell) => !cell)) {
    throw new Error("CSV header contains duplicate or empty column names.");
  }
  for (const column of ["week_of", "facility_name", "metric_key"]) {
    if (!header.includes(column)) throw new Error(`Unsupported CSV layout: missing '${column}'. Review and normalize the workbook layout before importing.`);
  }
  return rows.map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`CSV row ${index + 2} has ${cells.length} cells; expected ${header.length}.`);
    return Object.fromEntries(header.map((name, i) => [name, cells[i]]));
  });
}

async function restRequest(method, route, { payload = undefined, query = undefined, headers = undefined } = {}) {
  const base = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`${base.replace(/\/$/, "")}/rest/v1/${route}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: payload == null ? undefined : JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${route} failed (${response.status}): ${text}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const fingerprint = (content) => createHash("sha256").update(content).digest("hex");

async function fetchAll(route, query) {
  const rows = [];
  // Honor small PostgREST server caps too: advance by the actual returned count.
  while (true) {
    const page = await restRequest("GET", route, { query: { ...query, order: "id.asc", limit: "1000", offset: String(rows.length) } });
    if (!Array.isArray(page)) throw new Error(`Invalid ${route} response`);
    if (!page.length) return rows;
    rows.push(...page);
  }
}

export function normalizeRows(rows, facilities, definitions) {
  const facilitiesByName = new Map();
  for (const facility of facilities) {
    if (facilitiesByName.has(facility.name)) throw new Error(`Ambiguous facility name '${facility.name}'; resolve identity before import.`);
    facilitiesByName.set(facility.name, facility.id);
  }
  const definitionsByKey = new Map(definitions.map((row) => [row.key, row]));
  const seen = new Set();
  return rows.map((row, index) => {
    const sourceRow = index + 2;
    const weekOf = row.week_of.trim();
    const date = new Date(`${weekOf}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== weekOf) {
      throw new Error(`Invalid week_of on row ${sourceRow}; use YYYY-MM-DD.`);
    }
    const facilityName = row.facility_name.trim();
    if (!facilityName) throw new Error(`Missing facility_name on row ${sourceRow}; use Total explicitly for portfolio rows.`);
    const facilityId = facilityName.toLowerCase() === "total" ? null : facilitiesByName.get(facilityName);
    if (facilityId === undefined) throw new Error(`Unknown facility_name '${facilityName}' on row ${sourceRow}.`);
    const metricKey = row.metric_key.trim();
    const definition = definitionsByKey.get(metricKey);
    if (!definition) throw new Error(`Unknown metric_key '${metricKey}' on row ${sourceRow}.`);
    if ((facilityId === null && !definition.total_scope) || (facilityId !== null && !definition.facility_scope)) {
      throw new Error(`Metric scope mismatch on row ${sourceRow}.`);
    }
    const rawValue = row.value_numeric?.trim() ?? "";
    // Do not coerce currency symbols, dates, percentages or hexadecimal into numbers.
    if (rawValue && !/^-?\d+(?:\.\d{1,2})?$/.test(rawValue)) throw new Error(`Ambiguous value_numeric on row ${sourceRow}; normalize units explicitly.`);
    const value = rawValue ? Number(rawValue) : null;
    if (value !== null && (!Number.isFinite(value) || Math.abs(value) >= 1e12)) throw new Error(`value_numeric exceeds storage range on row ${sourceRow}.`);
    if (definition.value_type === "count" && value !== null && !Number.isInteger(value)) throw new Error(`Fractional count on row ${sourceRow}; resolve the source meaning before publication.`);
    if (definition.value_type === "currency" && value !== null && !Number.isInteger(value)) throw new Error(`Currency must be whole cents on row ${sourceRow}.`);
    const valueText = row.value_text?.trim() || null;
    if ((definition.value_type === "text" && value !== null) || (definition.value_type !== "text" && valueText !== null)) {
      throw new Error(`Value type disagrees with metric definition on row ${sourceRow}.`);
    }
    const section = row.section_key?.trim() || definition.section_key;
    if (section !== definition.section_key) throw new Error(`section_key disagrees with metric definition on row ${sourceRow}.`);
    const key = JSON.stringify([weekOf, facilityId, metricKey]);
    if (seen.has(key)) throw new Error(`Duplicate week/facility/metric on row ${sourceRow}.`);
    seen.add(key);
    return {
      week_of: weekOf, facility_id: facilityId, metric_key: metricKey,
      metric_label: row.metric_label?.trim() || definition.label, section_key: section,
      value_numeric: value, value_text: valueText,
      source_row: sourceRow, source_cells: row,
    };
  });
}

export function reviewContext(facilities, definitions) {
  return { facility_ids: facilities.map((row) => row.id).sort(), metric_definitions: [...definitions].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) };
}

// PostgREST may reorder JSON keys; compare value meaning, not object key insertion order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const equivalent = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function buildReviewPlan({ organizationId, fileName, content, rows, facilities, definitions, snapshots, existingMetrics }) {
  const weeks = [...new Set(rows.map((row) => row.week_of))].sort();
  const expectedVersions = Object.fromEntries(weeks.map((week) => [week, snapshots.find((row) => row.week_of === week)?.published_version ?? 0]));
  const expectedCells = definitions.reduce((sum, def) => sum + (def.facility_scope ? facilities.length : 0) + (def.total_scope ? 1 : 0), 0);
  const comparisons = weeks.map((week) => {
    const snapshot = snapshots.find((row) => row.week_of === week);
    const previous = existingMetrics.filter((row) => row.snapshot_id === snapshot?.id);
    const incoming = rows.filter((row) => row.week_of === week);
    const key = (row) => JSON.stringify([row.facility_id, row.metric_key]);
    const incomingByKey = new Map(incoming.map((row) => [key(row), row]));
    const previousByKey = new Map(previous.map((row) => [key(row), row]));
    const populated = incoming.filter((row) => row.value_numeric !== null || row.value_text !== null).length;
    return {
      week_of: week, expected_version: expectedVersions[week], submitted_cells: incoming.length,
      expected_cells: expectedCells, populated_cells: populated,
      completeness_pct: expectedCells ? Math.round(populated / expectedCells * 10000) / 100 : 0,
      missing_cells: expectedCells - incoming.length,
      added: incoming.filter((row) => !previousByKey.has(key(row))),
      changed: incoming.filter((row) => {
        const old = previousByKey.get(key(row));
        return old && (old.value_numeric !== row.value_numeric || old.value_text !== row.value_text || old.metric_label !== row.metric_label || old.section_key !== row.section_key);
      }).map((row) => ({ before: previousByKey.get(key(row)), after: row })),
      removed: previous.filter((row) => !incomingByKey.has(key(row))),
    };
  });
  return { format: "haven-standup-review-v1", organization_id: organizationId, file_name: fileName,
    file_sha256: fingerprint(content), rows, expected_versions: expectedVersions, comparisons,
    expected_context: reviewContext(facilities, definitions), coverage_basis: "current_active_registry",
    source_as_of: null, definitions_status: "Review reference required; label equivalence is not established by this plan." };
}

export function validateReviewedPlan(plan, organizationId, content, rows, context) {
  if (plan.format !== "haven-standup-review-v1" || plan.organization_id !== organizationId || plan.file_sha256 !== fingerprint(content) || !equivalent(plan.rows, rows)) {
    throw new Error("Review plan does not match this organization, source file, or current facility/metric mapping. Generate and review a fresh plan.");
  }
  if (!context || !equivalent(plan.expected_context, context)) throw new Error("Active facilities or metric definitions changed after review. Generate and review a fresh plan.");
  const weeks = [...new Set(rows.map((row) => row.week_of))].sort();
  if (!plan.expected_versions || JSON.stringify(Object.keys(plan.expected_versions).sort()) !== JSON.stringify(weeks) || Object.values(plan.expected_versions).some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("Review plan has invalid expected versions.");
  }
}

export async function main(args = process.argv.slice(2)) {
  const positional = [];
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (["--dry-run", "--publish"].includes(arg)) options[arg] = true;
    else if (["--plan", "--definition-reference", "--correction-reason"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg] = args[++i];
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  if (!positional[0] || positional.length > 2 || (options["--dry-run"] && options["--publish"])) {
    throw new Error("Usage: node scripts/import-executive-standup-csv.mjs file.csv [organization-id] [--dry-run | --publish --plan reviewed.json --definition-reference reference --correction-reason reason]");
  }
  const filePath = positional[0];
  const organizationId = positional[1] ?? process.env.HAVEN_ORGANIZATION_ID ?? DEFAULT_ORG_ID;
  const content = fs.readFileSync(filePath);
  // Parse layout before even contacting the source system.
  const parsed = parseCsv(content.toString("utf8"));
  const scope = { organization_id: `eq.${organizationId}`, deleted_at: "is.null" };
  const [facilities, definitions] = await Promise.all([
    fetchAll("facilities", { ...scope, status: "eq.active", select: "id,name" }),
    fetchAll("exec_standup_metric_definitions", { ...scope, active: "eq.true", select: "*" }),
  ]);
  const rows = normalizeRows(parsed, facilities, definitions);
  if (options["--publish"]) {
    if (!options["--plan"] || !options["--definition-reference"]?.trim()) throw new Error("Publication requires the reviewed --plan and --definition-reference.");
    const plan = JSON.parse(fs.readFileSync(options["--plan"], "utf8"));
    validateReviewedPlan(plan, organizationId, content, rows, reviewContext(facilities, definitions));
    if (Object.values(plan.expected_versions).some((version) => version > 0) && !options["--correction-reason"]?.trim()) throw new Error("Correcting an existing week requires --correction-reason.");
    const result = await restRequest("POST", "rpc/haven_publish_standup_import", { payload: {
      p_organization_id: organizationId, p_file_sha256: plan.file_sha256, p_file_name: path.basename(filePath),
      p_rows: rows, p_expected_versions: plan.expected_versions,
      p_correction_reason: options["--correction-reason"]?.trim() || null,
      p_definition_reference: options["--definition-reference"].trim(),
      p_expected_context: plan.expected_context,
    } });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const snapshots = [];
  const existingMetrics = [];
  for (const week of [...new Set(rows.map((row) => row.week_of))].sort()) {
    const saved = await fetchAll("exec_standup_snapshots", { ...scope, week_of: `eq.${week}`, select: "id,week_of,published_version" });
    snapshots.push(...saved);
    for (const snapshot of saved) existingMetrics.push(...await fetchAll("exec_standup_snapshot_metrics", { ...scope, snapshot_id: `eq.${snapshot.id}`, select: "id,snapshot_id,facility_id,metric_key,metric_label,section_key,value_numeric,value_text" }));
  }
  const plan = buildReviewPlan({ organizationId, fileName: path.basename(filePath), content, rows, facilities, definitions, snapshots, existingMetrics });
  console.log(JSON.stringify(plan, null, 2));
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
