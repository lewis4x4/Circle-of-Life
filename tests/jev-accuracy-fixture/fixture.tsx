import { createRoot } from "react-dom/client";

import { JevAccuracyView } from "@/components/document-intake/accuracy/JevAccuracyView";
import { parseAccuracyWindow } from "@/lib/document-intake/jev-accuracy-report";
import "@/app/globals.css";

const params = new URLSearchParams(window.location.search);

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-[1440px] p-4 md:p-8">
    <JevAccuracyView initialWindow={parseAccuracyWindow(params.get("window"))} initialType={params.get("type")} />
  </main>,
);
