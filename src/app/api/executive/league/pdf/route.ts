import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { buildExecutiveLeaguePrintHtml } from "@/lib/executive/league-print";
import { loadExecutiveLeagueData } from "@/lib/executive/load-league-data";
import {
  REPORT_EXPORT_BUCKET,
  executiveLeaguePdfStoragePath,
} from "@/lib/reports/export-storage";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminApiActor();
  if ("response" in auth) return auth.response;

  const data = await loadExecutiveLeagueData(auth.actor.admin, auth.actor.organization_id);
  const html = buildExecutiveLeaguePrintHtml(data);

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

    const storagePath = executiveLeaguePdfStoragePath(auth.actor.organization_id);
    const upload = await auth.actor.admin.storage
      .from(REPORT_EXPORT_BUCKET)
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upload.error) {
      console.error("[executive-league-pdf] storage", upload.error);
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="executive-league.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[executive-league-pdf] render", error);
    return NextResponse.json(
      { error: "Could not generate executive league PDF." },
      { status: 500 },
    );
  } finally {
    await browser?.close();
  }
}
