import { NextResponse } from "next/server";
import { z } from "zod";

import { csvEscapeCell } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/server";

const exportBodySchema = z.object({
  dashboardId: z.string().trim().min(1).max(200),
  format: z.enum(["csv", "xlsx", "pdf"]),
  columns: z
    .array(z.object({ id: z.string(), header: z.string() }))
    .min(1)
    .max(60),
  rows: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .max(50_000),
  filename: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof exportBodySchema>;
  try {
    body = exportBodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid export body",
        detail: error instanceof z.ZodError ? error.flatten() : String(error),
      },
      { status: 400 },
    );
  }

  if (body.format !== "csv") {
    return NextResponse.json(
      {
        error: "Format not yet implemented in this slice",
        detail:
          "S6 ships CSV; XLSX and PDF exports require additional dependencies (SheetJS / @sparticuz/chromium) tracked as a follow-up. Use format=csv for now.",
        format: body.format,
      },
      { status: 501 },
    );
  }

  const csv = buildCsv(body.columns, body.rows);
  const filename =
    (body.filename?.trim() || `${body.dashboardId.replace(/[^a-z0-9_-]/gi, "-")}-export`) +
    ".csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function buildCsv(
  columns: Array<{ id: string; header: string }>,
  rows: Array<Record<string, string | number | boolean | null>>,
): string {
  const headerLine = columns.map((c) => csvEscapeCell(c.header)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const value = row[column.id];
        if (value == null) return "";
        return csvEscapeCell(String(value));
      })
      .join(","),
  );
  return [headerLine, ...lines].join("\r\n");
}
