import { SurveyPackChooser } from "@/components/registers/SurveyPackChooser";

export const dynamic = "force-dynamic";

/**
 * Choosing what goes in the pack. The pack itself prints at /print/survey-pack,
 * outside the app shell, so nothing on this page ends up on the paper.
 */
export default function SurveyPackPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-medium text-foreground">Survey print pack</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Print the admission and discharge register, the census record and the visitor log for a
          range. Every print is recorded, so there is a record of what a surveyor was handed.
        </p>
      </div>
      <SurveyPackChooser />
    </main>
  );
}
