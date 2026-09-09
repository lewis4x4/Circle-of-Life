import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { buildExecutiveLeaguePrintHtml } from "@/lib/executive/league-print";
import { loadExecutiveLeagueData } from "@/lib/executive/load-league-data";
import { logError } from "@/lib/observability/logger";
import {
  REPORT_EXPORT_BUCKET,
  executiveLeaguePdfStoragePath,
} from "@/lib/reports/export-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PORTFOLIO_ROLES = ["owner", "org_admin"] as const;

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET() {
  const auth = await requireCurrentApiActor({
    allowedRoles: PORTFOLIO_ROLES,
    scope: "executive.league.pdf",
  });
  if ("response" in auth) return privateResponse(auth.response);
  const { actor } = auth;

  let browser;
  try {
    const data = await loadExecutiveLeagueData(actor.admin, actor.organizationId);
    const html = buildExecutiveLeaguePrintHtml(data);
    const { chromium } = await import("playwright");
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

    const storageAuth = await revalidateCurrentApiActor(actor, {
      allowedRoles: PORTFOLIO_ROLES,
      scope: "executive.league.pdf.storage-revalidate",
    });
    if ("response" in storageAuth) return privateResponse(storageAuth.response);
    if (storageAuth.actor.organizationId !== actor.organizationId) {
      return privateResponse(NextResponse.json({ error: "Report not found." }, { status: 404 }));
    }
    const storagePath = executiveLeaguePdfStoragePath(actor.organizationId);
    const upload = await storageAuth.actor.admin.storage
      .from(REPORT_EXPORT_BUCKET)
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upload.error) {
      logError("executive.league.pdf.storage", upload.error);
    }

    const returnAuth = await revalidateCurrentApiActor(storageAuth.actor, {
      allowedRoles: PORTFOLIO_ROLES,
      scope: "executive.league.pdf.return-revalidate",
    });
    if ("response" in returnAuth) return privateResponse(returnAuth.response);
    if (returnAuth.actor.organizationId !== actor.organizationId) {
      return privateResponse(NextResponse.json({ error: "Report not found." }, { status: 404 }));
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'attachment; filename="executive-league.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logError("executive.league.pdf.render", error);
    return NextResponse.json(
      { error: "Could not generate executive league PDF." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  } finally {
    await browser?.close();
  }
}
