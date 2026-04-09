/**
 * Google OAuth for Business Profile / review APIs (Module 23).
 * Env: REPUTATION_GOOGLE_CLIENT_ID, REPUTATION_GOOGLE_CLIENT_SECRET, REPUTATION_GOOGLE_REDIRECT_URI
 */

export const GOOGLE_BUSINESS_MANAGE_SCOPE = "https://www.googleapis.com/auth/business.manage";

export function googleOAuthEnvReady(): boolean {
  return Boolean(
    process.env.REPUTATION_GOOGLE_CLIENT_ID?.trim() &&
      process.env.REPUTATION_GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.REPUTATION_GOOGLE_REDIRECT_URI?.trim(),
  );
}

export function buildGoogleAuthorizeUrl(state: string): string {
  const clientId = process.env.REPUTATION_GOOGLE_CLIENT_ID!.trim();
  const redirectUri = process.env.REPUTATION_GOOGLE_REDIRECT_URI!.trim();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_BUSINESS_MANAGE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeAuthorizationCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const clientId = process.env.REPUTATION_GOOGLE_CLIENT_ID!.trim();
  const clientSecret = process.env.REPUTATION_GOOGLE_CLIENT_SECRET!.trim();
  const redirectUri = process.env.REPUTATION_GOOGLE_REDIRECT_URI!.trim();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    const msg = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in ?? 3600,
  };
}
