import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { buildResidentIntakeExtractionPrompt, callResidentIntakeProvider, prepareSourceForProvider, stageResultFromExtraction } from "./parser";
import type { ProviderExtraction } from "./schemas";

const source = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: "image/jpeg" as const, normalized: false };

function providerResponse(text: string) {
  return new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 20 } }), { status: 200 });
}

describe("resident intake provider adapter", () => {
  it("normalizes a HEIC/HEIF-declared source to an in-memory JPEG without mutating source bytes", async () => {
    const original = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer());
    const before = Buffer.from(original).toString("hex");
    const result = await prepareSourceForProvider(original, "image/heic");
    expect(result.mediaType).toBe("image/jpeg");
    expect(result.normalized).toBe(true);
    expect([...result.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(Buffer.from(original).toString("hex")).toBe(before);
  });

  it("validates the allowlist and maps a controlled result for staging", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providerResponse(JSON.stringify({
      source_classification: "resident",
      document_class: "demographics_face_sheet",
      pages: [{ page_number: 1, classification: "resident", document_class: "demographics_face_sheet", confidence: 0.98 }],
      facts: [{ field_code: "resident.first_name", value: "Ada", display_value: "Ada", page_numbers: [1], confidence: 0.95, evidence: "Printed given name" }],
      warnings: [],
    })));
    const result = await callResidentIntakeProvider({ apiKey: "test", model: "test-model", source, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.extraction && stageResultFromExtraction(result.extraction)).toMatchObject({
      source_class: "resident",
      document_type: "demographics_face_sheet",
      facts: [{ field_code: "resident.first_name", domain: "demographics", structured_value: "Ada" }],
    });
  });

  it("rejects schema-invalid provider output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providerResponse(JSON.stringify({
      source_classification: "resident",
      document_class: "attacker_table",
      pages: [],
      facts: [],
      warnings: [],
    })));
    await expect(callResidentIntakeProvider({ apiKey: "test", model: "test-model", source, fetchImpl })).rejects.toThrow();
  });

  it("revalidates every fact value inside the staging boundary", () => {
    const extraction = {
      source_classification: "resident",
      document_class: "insurance_card",
      pages: [{ page_number: 1, classification: "resident", document_class: "insurance_card", confidence: 0.9 }],
      facts: [{ field_code: "resident.payer", value: { payer_name: "Missing canonical fields" }, display_value: "Example payer", page_numbers: [1], confidence: 0.9, evidence: null }],
      warnings: [],
    } as ProviderExtraction;
    expect(() => stageResultFromExtraction(extraction)).toThrow();
  });

  it("includes canonical writer value schemas in the provider prompt", () => {
    const prompt = buildResidentIntakeExtractionPrompt();
    expect(prompt).toContain("payer_type");
    expect(prompt).toContain("effective_date");
    expect(prompt).toContain("scheduled_times");
    expect(prompt).toContain("contract_type");
  });

  it("turns credential-bearing output into pattern codes without returning the canary", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providerResponse('{"password":"resident-intake-secret-canary"}'));
    const result = await callResidentIntakeProvider({ apiKey: "test", model: "test-model", source, fetchImpl });
    expect(result.extraction).toBeNull();
    expect(result.credentialPatternCodes).toEqual(["credential_assignment"]);
    expect(JSON.stringify(result)).not.toContain("resident-intake-secret-canary");
  });
});
