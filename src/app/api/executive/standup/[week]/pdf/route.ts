import { NextResponse } from "next/server";
import { chromium } from "playwright";

import {
  buildStandupBoardPrintHtml,
  fetchPreviousPublishedStandupSnapshotDetail,
  fetchStandupSnapshotDetail,
} from "@/lib/executive/standup";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
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

  const html = buildStandupBoardPrintHtml(detail, previous);

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
    return NextResponse.json({ error: "Could not generate standup PDF." }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
