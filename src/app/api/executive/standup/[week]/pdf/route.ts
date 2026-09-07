import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import {
  buildStandupBoardPrintHtml,
  fetchPreviousPublishedStandupSnapshotDetail,
  fetchStandupSnapshotDetail,
} from "@/lib/executive/standup";
import { logError } from "@/lib/observability/logger";
import {
  EXECUTIVE_STANDUP_PACKET_RENDER_VERSION,
  executiveStandupPdfStoragePath,
  looksLikeStorageObjectPath,
  REPORT_EXPORT_BUCKET,
} from "@/lib/reports/export-storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ week: string }> },
) {
  const { week } = await context.params;
  if (!week) {
    return NextResponse.json({ error: "Standup week is required." }, { status: 400 });
  }

  const actorResult = await requireCurrentApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin"],
    scope: "executive.standup.pdf",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const [detail, previous] = await Promise.all([
    fetchStandupSnapshotDetail(admin, actor.organizationId, week),
    fetchPreviousPublishedStandupSnapshotDetail(admin, actor.organizationId, week),
  ]);

  if (!detail) {
    return NextResponse.json({ error: "Standup packet not found" }, { status: 404 });
  }

  const storagePath = executiveStandupPdfStoragePath(
    actor.organizationId,
    detail.snapshot.weekOf,
    detail.snapshot.publishedVersion,
  );

  if (looksLikeStorageObjectPath(detail.snapshot.pdfAttachmentPath) && detail.snapshot.pdfAttachmentPath === storagePath) {
    const cached = await admin.storage.from(REPORT_EXPORT_BUCKET).download(detail.snapshot.pdfAttachmentPath);
    if (!cached.error && cached.data) {
      const bytes = new Uint8Array(await cached.data.arrayBuffer());
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="executive-standup-${detail.snapshot.weekOf}.pdf"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
  }

  const html = buildStandupBoardPrintHtml(detail, previous);
  const url = new URL(request.url);
  const reportId = url.searchParams.get("reportId")?.trim() || null;
  const playwrightWsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT?.trim();

  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = playwrightWsEndpoint
      ? await chromium.connect(playwrightWsEndpoint)
      : await chromium.launch({
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
    const storageActorResult = await revalidateCurrentApiActor(actor, {
      allowedRoles: ["owner", "org_admin", "facility_admin"],
      scope: "executive.standup.pdf.storage-revalidate",
    });
    if ("response" in storageActorResult) return storageActorResult.response;
    const storageActor = storageActorResult.actor;
    if (storageActor.organizationId !== actor.organizationId) {
      return NextResponse.json({ error: "Standup packet not found" }, { status: 404 });
    }
    const upload = await storageActor.admin.storage
      .from(REPORT_EXPORT_BUCKET)
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upload.error) {
      logError("executive.standup.pdf.storage", upload.error, { week });
    } else {
      await storageActor.admin
        .from("exec_standup_snapshots" as never)
        .update({
          pdf_attachment_path: storagePath,
        } as never)
        .eq("id", detail.snapshot.id)
        .eq("organization_id", actor.organizationId);
    }

    if (reportId) {
      const reportActorResult = await revalidateCurrentApiActor(storageActor, {
        allowedRoles: ["owner", "org_admin", "facility_admin"],
        scope: "executive.standup.pdf.report-revalidate",
      });
      if ("response" in reportActorResult) return reportActorResult.response;
      const reportActor = reportActorResult.actor;
      if (reportActor.organizationId !== actor.organizationId) {
        return NextResponse.json({ error: "Standup packet not found" }, { status: 404 });
      }
      const { data: runRow, error: runErr } = await reportActor.admin
        .from("report_runs")
        .insert({
          organization_id: reportActor.organizationId,
          source_type: "pack",
          source_id: reportId,
          status: "completed",
          generated_by_user_id: reportActor.id,
          runtime_classification: "standup_packet_pdf",
          run_scope_json: { weekOf: detail.snapshot.weekOf },
          filter_snapshot_json: { weekOf: detail.snapshot.weekOf },
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (!runErr && runRow?.id) {
        await reportActor.admin.from("report_exports").insert({
          organization_id: reportActor.organizationId,
          report_run_id: runRow.id,
          export_format: "pdf",
          file_name: `executive-standup-${detail.snapshot.weekOf}.pdf`,
          storage_path: upload.error ? `/api/executive/standup/${encodeURIComponent(detail.snapshot.weekOf)}/pdf` : storagePath,
          delivered_to_json: {
            delivery: "download",
            kind: "executive_standup_board_packet",
            weekOf: detail.snapshot.weekOf,
            renderVersion: EXECUTIVE_STANDUP_PACKET_RENDER_VERSION,
          },
        });
      }

      await reportActor.admin
        .from("exec_saved_reports")
        .update({
          last_generated_at: new Date().toISOString(),
          last_output_storage_path: upload.error ? `/api/executive/standup/${encodeURIComponent(detail.snapshot.weekOf)}/pdf` : storagePath,
        })
        .eq("id", reportId)
        .eq("organization_id", reportActor.organizationId);
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="executive-standup-${detail.snapshot.weekOf}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logError("executive.standup.pdf.render", error, { week });
    return NextResponse.json(
      { error: "Could not generate standup PDF." },
      { status: 500 },
    );
  } finally {
    await browser?.close();
  }
}
