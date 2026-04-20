import { NextResponse } from "next/server";
import { chromium } from "playwright";

import {
  buildStandupBoardPrintHtml,
  fetchPreviousPublishedStandupSnapshotDetail,
  fetchStandupSnapshotDetail,
} from "@/lib/executive/standup";
import {
  EXECUTIVE_STANDUP_PACKET_RENDER_VERSION,
  executiveStandupPdfStoragePath,
  looksLikeStorageObjectPath,
  REPORT_EXPORT_BUCKET,
} from "@/lib/reports/export-storage";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ week: string }> },
) {
  const { week } = await context.params;
  if (!week) {
    return NextResponse.json({ error: "Standup week is required." }, { status: 400 });
  }

  const sessionClient = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await sessionClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (error) {
    console.error("[standup-pdf] service role", error);
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const { data: profile, error: profileErr } = await admin
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileErr || !profile?.organization_id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  if (!["owner", "org_admin", "facility_admin"].includes(profile.app_role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const [detail, previous] = await Promise.all([
    fetchStandupSnapshotDetail(admin, profile.organization_id, week),
    fetchPreviousPublishedStandupSnapshotDetail(admin, profile.organization_id, week),
  ]);

  if (!detail) {
    return NextResponse.json({ error: "Standup packet not found" }, { status: 404 });
  }

  const storagePath = executiveStandupPdfStoragePath(
    profile.organization_id,
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
    const upload = await admin.storage
      .from(REPORT_EXPORT_BUCKET)
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upload.error) {
      console.error("[standup-pdf] storage", upload.error);
    } else {
      await admin
        .from("exec_standup_snapshots" as never)
        .update({
          pdf_attachment_path: storagePath,
        } as never)
        .eq("id", detail.snapshot.id)
        .eq("organization_id", profile.organization_id);
    }

    if (reportId) {
      const { data: runRow, error: runErr } = await admin
        .from("report_runs")
        .insert({
          organization_id: profile.organization_id,
          source_type: "pack",
          source_id: reportId,
          status: "completed",
          generated_by_user_id: user.id,
          runtime_classification: "standup_packet_pdf",
          run_scope_json: { weekOf: detail.snapshot.weekOf },
          filter_snapshot_json: { weekOf: detail.snapshot.weekOf },
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (!runErr && runRow?.id) {
        await admin.from("report_exports").insert({
          organization_id: profile.organization_id,
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

      await admin
        .from("exec_saved_reports")
        .update({
          last_generated_at: new Date().toISOString(),
          last_output_storage_path: upload.error ? `/api/executive/standup/${encodeURIComponent(detail.snapshot.weekOf)}/pdf` : storagePath,
        })
        .eq("id", reportId)
        .eq("organization_id", profile.organization_id);
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
    console.error("[standup-pdf] render", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Could not generate standup PDF.",
        detail: message,
      },
      { status: 500 },
    );
  } finally {
    await browser?.close();
  }
}
