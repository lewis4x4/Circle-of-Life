"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { SITE_TITLE, documentTitleFor } from "@/lib/a11y/document-title";

/**
 * Gives every page a specific document title (WCAG 2.4.2, COL-658) from its
 * one h1, so the browser tab, history and screen-reader page announcement say
 * which page this is instead of "Haven — Circle of Life" everywhere. Most
 * Haven pages are client components and cannot export `metadata`, and their
 * h1 often settles after data loads (a resident or facility name), so the
 * title follows the h1 as it changes.
 *
 * A page that sets its own title through `metadata` keeps it: the title is
 * only replaced while it is the shared site title or one this component set.
 */
export function DocumentTitleFromHeading() {
  const pathname = usePathname();

  useEffect(() => {
    let lastSet: string | null = null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const current = document.title;
      if (current !== SITE_TITLE && current !== lastSet) return;
      const next = documentTitleFor(document.querySelector("h1")?.textContent);
      if (next !== current) document.title = next;
      lastSet = next;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
