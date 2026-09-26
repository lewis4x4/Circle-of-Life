import { JevAccuracyView } from "@/components/document-intake/accuracy/JevAccuracyView";
import { parseAccuracyWindow } from "@/lib/document-intake/jev-accuracy-report";

const TYPE_CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Jev accuracy (COL-771, DI-10): per document type, how far to trust Jev's pre-selection. Same gate as the queue. */
export default async function JevAccuracyPage({ searchParams }: { searchParams: Promise<{ window?: string; type?: string }> }) {
  const { window, type } = await searchParams;
  return <JevAccuracyView initialWindow={parseAccuracyWindow(window)} initialType={type && TYPE_CODE_RE.test(type) ? type : null} />;
}
