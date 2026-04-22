import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { requireAdminApiActor, actorCanAccessFacility } from "@/lib/admin/api-auth";
import { loadSurveyBundlePacket } from "@/lib/risk/load-survey-bundle";
import { buildSurveyBundlePrintHtml } from "@/lib/risk/survey-bundle-print";
import {
  REPORT_EXPORT_BUCKET,
  riskSurveyBundlePdfStoragePath,
} from "@/lib/reports/export-storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ facilityId: string }> },
) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) return auth.response;

  const { facilityId } = await context.params;
  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required." }, { status: 400 });
  }

  const hasAccess = await actorCanAccessFacility(auth.actor, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility." }, { status: 403 });
  }

  const packet = await loadSurveyBundlePacket(auth.actor.admin, auth.actor.organization_id, facilityId);
  const html = buildSurveyBundlePrintHtml(packet);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: {
        top: "0.35in",
        right: "0.35in",
        bottom: "0.35in",
        left: "0.35in",
      },
    });

    const storagePath = riskSurveyBundlePdfStoragePath(auth.actor.organization_id, facilityId);
    const upload = await auth.actor.admin.storage
      .from(REPORT_EXPORT_BUCKET)
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upload.error) {
      console.error("[survey-bundle-pdf] storage", upload.error);
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"survey-bundle-${packet.facility.name}.pdf\"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[survey-bundle-pdf] render", error);
    return NextResponse.json(
      { error: "Could not generate survey bundle PDF." },
      { status: 500 },
    );
  } finally {
    await browser?.close();
  }
}
