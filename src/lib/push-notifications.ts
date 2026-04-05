import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function getVapidPublicKeyBytes(): Uint8Array | null {
  const key =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ||
    process.env.VITE_VAPID_PUBLIC_KEY?.trim() ||
    "";
  if (!key) return null;
  try {
    return urlBase64ToUint8Array(key);
  } catch {
    return null;
  }
}

/**
 * Subscribe the browser to Web Push and persist to `notification_subscriptions`.
 */
export async function subscribePushAndSave(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const vapid = getVapidPublicKeyBytes();
  if (!vapid) {
    return { ok: false, error: "Push is not configured (missing NEXT_PUBLIC_VAPID_PUBLIC_KEY)." };
  }

  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, error: "Service workers are not supported in this browser." };
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return { ok: false, error: "Notification permission was not granted." };
  }

  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapid as BufferSource,
  });

  const json = sub.toJSON();
  const keys = json.keys;
  if (!keys?.p256dh || !keys?.auth) {
    return { ok: false, error: "Push subscription keys are missing." };
  }

  const endpoint = json.endpoint ?? sub.endpoint;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

  const { error } = await params.supabase.from("notification_subscriptions").upsert(
    {
      organization_id: params.organizationId,
      user_id: params.userId,
      endpoint,
      keys_json: { p256dh: keys.p256dh, auth: keys.auth },
      user_agent: ua,
      deleted_at: null,
      last_used_at: null,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function invokeDispatchPushTest(params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  userId: string;
  title?: string;
  body?: string;
}): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  const url = `${params.supabaseUrl.replace(/\/$/, "")}/functions/v1/dispatch-push`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      apikey: params.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: params.userId,
      title: params.title ?? "Haven",
      body: params.body ?? "Test notification",
      url: "/admin",
    }),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const msg =
      body && typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: string }).error)
        : `Request failed (${res.status})`;
    return { ok: false, status: res.status, message: msg };
  }

  return { ok: true, json: body };
}
