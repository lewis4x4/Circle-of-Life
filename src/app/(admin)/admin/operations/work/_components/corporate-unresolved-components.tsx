"use client";
import { useEffect, useState } from "react";
import { corporateUnresolvedComponentsSchema } from "@/lib/operations/corporate-deliverables";

type UnresolvedComponent = ReturnType<typeof corporateUnresolvedComponentsSchema.parse>["components"][number];

/**
 * Corporate deliverables Haven cannot run yet. COL-689: this used to print the raw
 * mapping / subject / source states ("Mapping: unconfirmed · Subject: unconfirmed ·
 * Source: unavailable") as unstyled text; it now says what that means for staff.
 */
export function CorporateUnresolvedComponents({ authorized }: { authorized: boolean }) {
  const [components, setComponents] = useState<UnresolvedComponent[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController();
    void fetch("/api/admin/operations/corporate-deliverables/unresolved", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error();
        setComponents(corporateUnresolvedComponentsSchema.parse(await response.json()).components);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load the corporate deliverables that are not set up yet.");
      });
    return () => controller.abort();
  }, [authorized]);
  if (!authorized) return null;
  return (
    <section
      aria-label="Corporate deliverables not set up yet"
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-foreground">Corporate deliverables not set up yet</h2>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {error}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {components.map((item) => (
            <li key={item.component_key} className="text-sm">
              <p className="font-medium text-foreground">{item.label}</p>
              <p className="text-muted-foreground">
                What it covers and where its data comes from are not confirmed yet, so Haven cannot schedule or
                prepare it. {item.reason}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
