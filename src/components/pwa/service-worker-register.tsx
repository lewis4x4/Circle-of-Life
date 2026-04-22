"use client";

import { useEffect } from "react";

/**
 * Registers the app shell service worker in supported browsers (production only).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).catch((err) => {
      console.warn("[sw] registration failed", err);
    });
  }, []);

  return null;
}
