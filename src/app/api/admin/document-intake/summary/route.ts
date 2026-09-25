import { readDocumentIntakeSummary } from "@/lib/document-intake/server/review";

export const runtime = "nodejs";

export async function GET() {
  return readDocumentIntakeSummary();
}
