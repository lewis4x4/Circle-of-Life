#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-run
/// <reference lib="deno.ns" />
// ^ scripts/ sits outside supabase/functions/deno.json, which is where the Edge
//   Function sources get their `deno.ns` lib from. Without this the imported
//   modules typecheck as browser code and every `Deno.env` fails.
/**
 * check-compliance-doc — run the HUD 232 / Berkadia questions against a local
 * document, without deploying anything and without writing a row.
 *
 * This is the calibration tool. It imports the same questions, the same
 * thresholds and the same routing the edge function uses, so a verdict here is
 * the verdict production would reach on the same text. Point it at documents
 * whose answer you already know — a compliant Rising Oaks endorsement and a
 * generic sample — and read the probability table, not just the route. A
 * threshold is only calibrated once you have seen where the good and the bad
 * documents actually land.
 *
 * Usage:
 *   npm run check:compliance-doc -- <file.pdf|file.txt> [...]
 *   npm run check:compliance-doc -- doc.pdf --facility "Rising Oaks ALF"
 *   npm run check:compliance-doc -- doc.pdf --expect blocked
 *   npm run check:compliance-doc -- doc.pdf --text   # print extracted text and stop
 *
 * `--facility` supplies the vault row's facility so the cross-check runs; it
 * applies to every file in the run. `--expect` makes the script exit non-zero
 * when a document does not land where you said it should.
 *
 * Key: TYPESAFE_API_KEY. Deno does not read `.env.local` on its own, so the npm
 * script passes `--env-file=.env.local`; exporting the key in the shell works
 * just as well.
 *
 * PDFs are extracted with `pdftotext -layout` (poppler, `brew install poppler`).
 * Layout is preserved because mortgagee wording lives in a box on an ACORD form
 * and reflowing it runs the lender's name into the next field.
 *
 * PHI: facility insurance documents only. TypeSafe has no BAA on file. Do not
 * point this at a resident record to "see what it says".
 */

import { evaluateSystemOne, TypeSafeError } from "../supabase/functions/_shared/typesafe-client.ts";
import {
  COMPLIANCE_QUESTIONS,
  COMPLIANCE_THRESHOLDS,
  QUESTIONS_VERSION,
} from "../supabase/functions/_shared/compliance-doc-questions.ts";
import { triageDocument } from "../supabase/functions/compliance-doc-check/handler.ts";

const ROUTES = ["blocked", "human_review", "pending_carrier", "send_ready"] as const;

function parseArgs(argv: string[]) {
  const files: string[] = [];
  let facility: string | null = null;
  let expect: string | null = null;
  let textOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--facility") facility = argv[++i] ?? null;
    else if (arg === "--expect") expect = argv[++i] ?? null;
    else if (arg === "--text") textOnly = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else files.push(arg);
  }

  if (files.length === 0) throw new Error("Give at least one file");
  if (expect && !ROUTES.includes(expect as typeof ROUTES[number])) {
    throw new Error(`--expect must be one of ${ROUTES.join(", ")}`);
  }
  return { files, facility, expect, textOnly };
}

async function extractText(path: string): Promise<string> {
  if (!path.toLowerCase().endsWith(".pdf")) return await Deno.readTextFile(path);

  const pdftotext = new Deno.Command("pdftotext", {
    args: ["-layout", path, "-"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await pdftotext.output();
  if (code !== 0) {
    throw new Error(`pdftotext failed: ${new TextDecoder().decode(stderr).trim()}`);
  }
  return new TextDecoder().decode(stdout);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1).padStart(5)}%`;
}

async function main() {
  const { files, facility, expect, textOnly } = parseArgs(Deno.args);

  if (textOnly) {
    for (const file of files) {
      console.log(`\n===== ${file} =====\n`);
      console.log(await extractText(file));
    }
    return;
  }

  const apiKey = Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY is not set. Export it or put it in .env.local.");
    Deno.exit(2);
  }

  console.log(`questions: ${QUESTIONS_VERSION}`);
  console.log(`facility (vault row): ${facility ?? "(none — cross-check skipped)"}\n`);

  let mismatches = 0;

  for (const file of files) {
    const text = (await extractText(file)).trim();
    if (!text) {
      console.error(`${file}: no text extracted — a scanned image needs OCR first.`);
      mismatches++;
      continue;
    }

    let response;
    try {
      response = await evaluateSystemOne({
        apiKey,
        state: text,
        questions: COMPLIANCE_QUESTIONS,
        timeoutMs: 30_000,
      });
    } catch (err) {
      const kind = err instanceof TypeSafeError ? err.kind : "unknown";
      console.error(`${file}: judgment unavailable (${kind})`);
      mismatches++;
      continue;
    }

    const triage = triageDocument(response, facility);

    console.log(`===== ${file} =====`);
    console.log(`  route                 ${triage.route}`);
    console.log(`  doc_type              ${triage.doc_type} (confidence ${pct(triage.doc_type_confidence)})`);
    console.log(
      `  facility_named        ${triage.facility_named} (confidence ${pct(triage.facility_confidence)}) match=${triage.facility_matches}`,
    );
    console.log(`  berkadia named        ${pct(triage.names_berkadia)}`);
    console.log(`  HUD secretary named   ${pct(triage.names_hud_secretary)}`);
    console.log(`  ISAOA/ATIMA present   ${pct(triage.isaoa_atima_present)}`);
    console.log(`  EPI period            ${triage.epi_period}`);
    console.log(`  carrier + policy      ${pct(triage.carrier_and_policy_identified)}`);
    console.log(`  is draft              ${pct(triage.is_draft)}`);
    console.log(`  readiness             ${triage.readiness.toFixed(2)} / 3`);
    console.log(`  flags                 ${triage.flags.join(", ") || "(none)"}`);
    console.log(`  uncertainties         ${triage.uncertainties.join(", ") || "(none)"}`);
    console.log(
      `  tokens                in ${response.usage?.input_tokens ?? "?"} / out ${response.usage?.output_tokens ?? "?"}`,
    );

    if (expect && triage.route !== expect) {
      console.log(`  EXPECTED              ${expect} — did not match`);
      mismatches++;
    }
    console.log("");
  }

  console.log(
    `thresholds: party present >= ${COMPLIANCE_THRESHOLDS.mortgageePartyPresent}, ` +
      `party absent < ${COMPLIANCE_THRESHOLDS.mortgageePartyAbsent}, ` +
      `send-ready score >= ${COMPLIANCE_THRESHOLDS.sendReadyScore}`,
  );
  console.log("Move them in _shared/compliance-doc-questions.ts and bump QUESTIONS_VERSION.");

  if (mismatches > 0) Deno.exit(1);
}

await main();
