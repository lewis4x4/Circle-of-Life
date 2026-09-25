import { prepareDocumentIntakeUpload } from "@/lib/document-intake/server/uploads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return prepareDocumentIntakeUpload(request);
}
