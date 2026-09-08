"use client";

import { useEffect, useState } from "react";

/** Key responses to their employee/request so stale evidence never crosses records. */
export function useEmployeeResource<T>(url: string, revision = 0) {
  const key = `${url}:${revision}`;
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null }>();
  useEffect(() => {
    let current = true;
    void fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load employee evidence.");
        if (current) setResult({ key, data: body, error: null });
      })
      .catch((error) => {
        if (current) setResult({ key, data: null, error: error instanceof Error ? error.message : "Could not load employee evidence." });
      });
    return () => { current = false; };
  }, [url, key]);
  return result?.key === key ? result : { data: null, error: null };
}
