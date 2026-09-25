#!/usr/bin/env -S deno run --allow-read --allow-run
/// <reference lib="deno.ns" />
/**
 * Offline text inspection only. COL-819 retires direct provider calibration:
 * a local file has no authenticated sender, bound envelope or open obligations.
 * Usage: npm run check:compliance-doc -- <file.pdf|file.txt> [...] --text
 */
import { INTAKE_REQUIRED } from "../supabase/functions/compliance-doc-check/legacy-policy.ts";

export async function main(args: string[]): Promise<number> {
  if (!args.includes("--text")) {
    console.error(`${INTAKE_REQUIRED.code}: ${INTAKE_REQUIRED.error}`);
    return 2;
  }
  const files = args.filter((arg) => arg !== "--text");
  if (!files.length || files.some((arg) => arg.startsWith("--"))) {
    console.error("Usage: check-compliance-doc <file.pdf|file.txt> [...] --text");
    return 2;
  }
  for (const file of files) {
    if (file.toLowerCase().endsWith(".pdf")) {
      const result = await new Deno.Command("pdftotext", {
        args: ["-layout", file, "-"], stdout: "piped", stderr: "piped",
      }).output();
      if (!result.success) throw new Error("pdftotext failed");
      console.log(new TextDecoder().decode(result.stdout));
    } else {
      console.log(await Deno.readTextFile(file));
    }
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
