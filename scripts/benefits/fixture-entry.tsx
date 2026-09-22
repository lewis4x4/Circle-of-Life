import { createRoot } from "react-dom/client";
import { BenefitsCaseWorkspace } from "@/components/benefits/BenefitsCaseWorkspace";
import { BenefitsQueue } from "@/components/benefits/BenefitsQueue";
import { BenefitsAccess } from "@/components/benefits/BenefitsAccess";
import "@/app/globals.css";
const view = new URLSearchParams(window.location.search).get("view");
createRoot(document.getElementById("root")!).render(
  <main className="p-4 md:p-8">
    <p className="text-sm text-muted-foreground">
      Synthetic component proof — fictional resident, mocked APIs, no hosted
      authentication or storage transport.
    </p>
    {view === "queue" ? (
      <BenefitsQueue />
    ) : view === "access" ? (
      <BenefitsAccess />
    ) : (
      <BenefitsCaseWorkspace id="33333333-3333-4333-8333-333333333333" />
    )}
  </main>,
);
