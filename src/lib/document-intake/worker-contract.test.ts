import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  candidateSchema,
  DESTINATION_KINDS,
  DOCUMENT_INTAKE_BUCKET,
  DOCUMENT_INTAKE_MAX_SOURCE_BYTES,
  DOCUMENT_INTAKE_MIME_TYPES,
  jevAnswerSchema,
  proposalResultSchema,
  stageStatusSchema,
  SUBJECT_KINDS,
} from "./contracts";
import * as deno from "../../../supabase/functions/_shared/document-intake-contract";

/** Strip `.default()` / `.optional()` / `.nullable()` wrappers. */
function inner(schema: z.ZodType): z.ZodType {
  let current = schema as z.ZodType & { unwrap?: () => z.ZodType };
  while (typeof current.unwrap === "function" && !("element" in current)) current = current.unwrap() as typeof current;
  return current;
}
function keysOf(schema: z.ZodType): string[] {
  return Object.keys((inner(schema) as z.ZodObject).shape);
}
function elementKeys(schema: z.ZodType): string[] {
  return keysOf((inner(schema) as z.ZodArray<z.ZodType>).element);
}
function enumOf(schema: z.ZodType): string[] {
  return [...(inner(schema) as z.ZodEnum).options] as string[];
}

const shape = proposalResultSchema.shape;

function validResult(): Record<string, unknown> {
  return {
    outcome: "proposed",
    outcome_code: "reader_and_jev",
    suggested_title: "AHCA Form 1823 — Jane Doe — 2026-09-01",
    summary: "Physician's report for one resident.",
    summary_pages: [1, 2],
    document_date: "2026-09-01",
    catalog_code: "form_1823",
    candidates: [
      { kind: "resident_document", catalog_code: "form_1823", subject_id: "20000000-0000-4000-8000-000000000001", label: "Jane Doe" },
      { kind: "none", catalog_code: "unknown", subject_id: null, label: "No safe destination" },
    ],
    proposed_candidate: 0,
    segments: [{ pages: [1, 2], catalog_code: "form_1823", title: null }],
    page_count: 2,
    reader: { provider: "anthropic", model: "claude-sonnet-5", subject_hints: { person_names: ["Jane Doe"] } },
    jev: { model: "jev-latest", questions_version: "intake-v1", answers: { destination: { type: "choice", choice: "c0", probabilities: { c0: 0.9, none: 0.1 }, confidence: 0.8 } } },
    checks: [{ code: "document_date_not_future", label: "Document date is not in the future", result: "pass", source: "code" }],
    warnings: [{ code: "same_name", message: "Two people share this name" }],
    stage_status: { reader: { state: "ran" }, jev: { state: "ran" } },
  };
}

describe("Deno worker contract matches contracts.ts", () => {
  it("names the same top-level result fields", () => {
    expect([...deno.PROPOSAL_RESULT_FIELDS].sort()).toEqual(Object.keys(shape).sort());
  });

  it("uses the same enums", () => {
    expect([...deno.PROPOSAL_OUTCOMES]).toEqual(enumOf(shape.outcome));
    expect([...deno.STAGE_STATES]).toEqual(enumOf(stageStatusSchema.shape.state));
    expect([...deno.CANDIDATE_KINDS]).toEqual(enumOf(candidateSchema.shape.kind));
    expect([...deno.JEV_ANSWER_TYPES]).toEqual(enumOf(jevAnswerSchema.shape.type));
    const check = (inner(shape.checks) as z.ZodArray<z.ZodObject>).element.shape;
    expect([...deno.CHECK_RESULTS]).toEqual(enumOf(check.result as z.ZodType));
    expect([...deno.CHECK_SOURCES]).toEqual(enumOf(check.source as z.ZodType));
    expect([...deno.DESTINATION_KINDS]).toEqual([...DESTINATION_KINDS]);
    expect([...deno.SUBJECT_KINDS]).toEqual([...SUBJECT_KINDS]);
    expect([...deno.DOCUMENT_INTAKE_MIME_TYPES]).toEqual([...DOCUMENT_INTAKE_MIME_TYPES]);
    expect(deno.DOCUMENT_INTAKE_BUCKET).toBe(DOCUMENT_INTAKE_BUCKET);
    expect(deno.DOCUMENT_INTAKE_MAX_SOURCE_BYTES).toBe(DOCUMENT_INTAKE_MAX_SOURCE_BYTES);
  });

  it("uses the same nested field names", () => {
    expect([...deno.CANDIDATE_FIELDS].sort()).toEqual(keysOf(candidateSchema).sort());
    expect([...deno.SEGMENT_FIELDS].sort()).toEqual(elementKeys(shape.segments).sort());
    expect([...deno.CHECK_FIELDS].sort()).toEqual(elementKeys(shape.checks).sort());
    expect([...deno.WARNING_FIELDS].sort()).toEqual(elementKeys(shape.warnings).sort());
    expect([...deno.STAGE_STATUS_FIELDS].sort()).toEqual(keysOf(stageStatusSchema).sort());
    expect([...deno.JEV_ANSWER_FIELDS].sort()).toEqual(keysOf(jevAnswerSchema).sort());
    expect(keysOf(shape.stage_status).sort()).toEqual(["jev", "reader"]);
  });

  it("accepts and refuses the same results", () => {
    const cases: Array<[string, (r: Record<string, unknown>) => void]> = [
      ["valid", () => {}],
      ["bad outcome", (r) => { r.outcome = "done"; }],
      ["long title", (r) => { r.suggested_title = "x".repeat(201); }],
      ["long summary", (r) => { r.summary = "x".repeat(601); }],
      ["bad date", (r) => { r.document_date = "09/01/2026"; }],
      ["zero page", (r) => { r.summary_pages = [0]; }],
      ["bad subject id", (r) => { (r.candidates as Array<Record<string, unknown>>)[0].subject_id = "not-a-uuid"; }],
      ["negative proposal", (r) => { r.proposed_candidate = -1; }],
      ["empty segment", (r) => { r.segments = [{ pages: [], catalog_code: null, title: null }]; }],
      ["bad stage", (r) => { r.stage_status = { reader: { state: "done" }, jev: { state: "ran" } }; }],
      ["missing jev stage", (r) => { r.stage_status = { reader: { state: "ran" } }; }],
      ["bad check source", (r) => { r.checks = [{ code: "a", label: "b", result: "pass", source: "ai" }]; }],
      ["bad probability", (r) => { r.jev = { answers: { d: { type: "choice", probabilities: { a: "high" } } } }; }],
      ["long outcome code", (r) => { r.outcome_code = "x".repeat(121); }],
      ["null page count", (r) => { r.page_count = null; }],
    ];
    for (const [name, mutate] of cases) {
      const value = validResult();
      mutate(value);
      const zodOk = proposalResultSchema.safeParse(value).success;
      const denoOk = deno.proposalResultProblems(value).length === 0;
      expect({ name, ok: denoOk }).toEqual({ name, ok: zodOk });
    }
  });
});
