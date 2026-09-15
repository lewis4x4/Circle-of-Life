"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  activateServiceWorkerUpdate,
  bindServiceWorkerUpdateListeners,
  SERVICE_WORKER_REGISTER_OPTIONS,
  SERVICE_WORKER_SCRIPT_URL,
} from "@/lib/pwa/service-worker-update";

import { ServiceWorkerUpdateBanner } from "./service-worker-update-banner";

/**
 * Registers the app shell service worker in supported browsers (production only)
 * and surfaces a Reload CTA when a newer build is waiting (COL-397).
 */
export function ServiceWorkerRegister() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let disposeListeners: (() => void) | undefined;

    void navigator.serviceWorker
      .register(SERVICE_WORKER_SCRIPT_URL, SERVICE_WORKER_REGISTER_OPTIONS)
      .then((registration) => {
        registrationRef.current = registration;
        disposeListeners = bindServiceWorkerUpdateListeners(registration, () => {
          setNeedRefresh(true);
        });
      })
      .catch((err) => {
        console.warn("[sw] registration failed", err);
      });

    return () => {
      disposeListeners?.();
    };
  }, []);

  const onReload = useCallback(() => {
    activateServiceWorkerUpdate(registrationRef.current);
  }, []);

  if (!needRefresh) return null;

  return <ServiceWorkerUpdateBanner onReload={onReload} />;
}
