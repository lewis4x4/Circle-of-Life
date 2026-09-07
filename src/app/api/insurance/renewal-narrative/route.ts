import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import type { RenewalPackagePayload } from "@/lib/insurance/assemble-renewal-package-payload";
import { buildTemplateRenewalNarrative } from "@/lib/insurance/renewal-narrative-template";
import { logError } from "@/lib/observability/logger";
import type { Database } from "@/types/database";

type Body = { renewalDataPackageId?: string };

const SYSTEM = `You are an insurance operations assistant for assisted living and senior care operators.
Write a concise internal renewal underwriting narrative (3–5 short paragraphs) using ONLY the structured metrics and policy facts provided.
Do not invent facility names, resident names, or incidents. Use plain text (no markdown headings).
State clearly that figures come from the operator's Haven system and require human review before external distribution.`;

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const renewalDataPackageId = body.renewalDataPackageId?.trim();
  if (!renewalDataPackageId) {
    return NextResponse.json({ error: "renewalDataPackageId is required" }, { status: 400 });
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: ["owner", "org_admin"],
    scope: "insurance.renewal-narrative",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const { data: pkg, error: pkgErr } = await admin
    .from("renewal_data_packages")
    .select("*, insurance_policies(policy_number, carrier_name)")
    .eq("id", renewalDataPackageId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pkgErr || !pkg) {
    return NextResponse.json({ error: "Renewal package not found" }, { status: 404 });
  }

  const row = pkg as Database["public"]["Tables"]["renewal_data_packages"]["Row"] & {
    insurance_policies: { policy_number: string; carrier_name: string } | null;
  };

  const policy = row.insurance_policies;
  if (!policy) {
    return NextResponse.json({ error: "Policy not found for this package" }, { status: 422 });
  }

  const payload = row.payload as unknown as RenewalPackagePayload;
  if (!payload?.metrics || !payload?.period) {
    return NextResponse.json({ error: "Package payload is missing metrics" }, { status: 422 });
  }

  const userContent = JSON.stringify({
    policy_number: policy.policy_number,
    carrier_name: policy.carrier_name,
    period: payload.period,
    metrics: payload.metrics,
    assembled_at: payload.assembled_at,
  });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_NARRATIVE_MODEL?.trim() || "gpt-4o-mini";

  let draftText: string;
  let source: "openai" | "template";

  if (apiKey) {
    const providerActorResult = await revalidateCurrentApiActor(actor, {
      allowedRoles: ["owner", "org_admin"],
      scope: "insurance.renewal-narrative.provider-revalidate",
    });
    if ("response" in providerActorResult) return providerActorResult.response;
    if (providerActorResult.actor.organizationId !== row.organization_id) {
      return NextResponse.json({ error: "Renewal package not found" }, { status: 404 });
    }
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          max_tokens: 1400,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userContent },
          ],
        }),
      });

      const raw = (await res.json()) as {
        error?: { message?: string };
        choices?: { message?: { content?: string } }[];
      };

      if (!res.ok) {
        const msg = raw.error?.message ?? res.statusText;
        logError("insurance.renewal-narrative", msg, { action: "openai_call", status: res.status, renewalDataPackageId });
        draftText = buildTemplateRenewalNarrative(payload, policy);
        source = "template";
      } else {
        const text = raw.choices?.[0]?.message?.content?.trim();
        if (!text) {
          draftText = buildTemplateRenewalNarrative(payload, policy);
          source = "template";
        } else {
          draftText = text;
          source = "openai";
        }
      }
    } catch (e) {
      logError("insurance.renewal-narrative", e, { action: "openai_fetch", renewalDataPackageId });
      draftText = buildTemplateRenewalNarrative(payload, policy);
      source = "template";
    }
  } else {
    draftText = buildTemplateRenewalNarrative(payload, policy);
    source = "template";
  }

  const now = new Date().toISOString();
  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: ["owner", "org_admin"],
    scope: "insurance.renewal-narrative.save-revalidate",
  });
  if ("response" in currentResult) return currentResult.response;
  if (currentResult.actor.organizationId !== row.organization_id) {
    return NextResponse.json({ error: "Renewal package not found" }, { status: 404 });
  }
  const { error: upErr } = await currentResult.actor.admin
    .from("renewal_data_packages")
    .update({
      ai_narrative_draft: draftText,
      ai_narrative_generated_at: now,
    })
    .eq("id", renewalDataPackageId)
    .eq("organization_id", currentResult.actor.organizationId);

  if (upErr) {
    logError("insurance.renewal-narrative", upErr, { action: "update_package", renewalDataPackageId });
    return NextResponse.json({ error: "Could not save narrative" }, { status: 500 });
  }

  return NextResponse.json({
    draft: draftText,
    source,
    generatedAt: now,
  });
}
