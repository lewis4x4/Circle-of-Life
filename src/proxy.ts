import { type NextRequest, NextResponse } from "next/server";
import { adminShellAccessRedirect, isAdminShellPath, mergeSetCookieHeaders } from "@/lib/auth/admin-shell";
import { caregiverShellAccessRedirect, isCaregiverShellPath } from "@/lib/auth/caregiver-shell";
import { dietaryShellAccessRedirect, isDietaryShellPath } from "@/lib/auth/dietary-shell";
import { familyShellAccessRedirect, isFamilyShellPath } from "@/lib/auth/family-shell";
import { isMedTechShellPath, medTechShellAccessRedirect } from "@/lib/auth/med-tech-shell";
import { isOnboardingShellPath, onboardingShellAccessRedirect } from "@/lib/auth/onboarding-shell";
import { resolveUiV2AdminRewritePath } from "@/lib/flags";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * True when the request targets one of the authenticated shells handled below.
 * Mirrors the `config.matcher` allow-list so non-shell paths (`/api/*`,
 * `/_next/*`, static assets, public pages) skip the Supabase session refresh.
 */
function needsShell(pathname: string): boolean {
  return (
    isAdminShellPath(pathname) ||
    isCaregiverShellPath(pathname) ||
    isDietaryShellPath(pathname) ||
    isMedTechShellPath(pathname) ||
    isFamilyShellPath(pathname) ||
    isOnboardingShellPath(pathname)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Short-circuit before building a Supabase client / decoding auth cookies for
  // any path that is not an authenticated shell. The matcher already narrows the
  // requests Next.js routes here; this keeps the guarantee enforced in code.
  if (!needsShell(pathname)) {
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  if (isAdminShellPath(pathname)) {
    const redirect = adminShellAccessRedirect(request, user);
    if (redirect) {
      mergeSetCookieHeaders(response, redirect);
      return redirect;
    }
    const rewritePath = resolveUiV2AdminRewritePath(pathname);
    if (rewritePath) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = rewritePath;
      const rewrite = NextResponse.rewrite(rewriteUrl);
      mergeSetCookieHeaders(response, rewrite);
      return rewrite;
    }
    return response;
  }

  if (isCaregiverShellPath(pathname)) {
    const redirect = caregiverShellAccessRedirect(request, user);
    if (redirect) {
      mergeSetCookieHeaders(response, redirect);
      return redirect;
    }
    return response;
  }

  if (isDietaryShellPath(pathname)) {
    const redirect = dietaryShellAccessRedirect(request, user);
    if (redirect) {
      mergeSetCookieHeaders(response, redirect);
      return redirect;
    }
    return response;
  }

  if (isMedTechShellPath(pathname)) {
    const redirect = medTechShellAccessRedirect(request, user);
    if (redirect) {
      mergeSetCookieHeaders(response, redirect);
      return redirect;
    }
    return response;
  }

  if (isFamilyShellPath(pathname)) {
    const redirect = familyShellAccessRedirect(request, user);
    if (redirect) {
      mergeSetCookieHeaders(response, redirect);
      return redirect;
    }
    return response;
  }

  if (isOnboardingShellPath(pathname)) {
    const redirect = onboardingShellAccessRedirect(request, user);
    if (redirect) {
      mergeSetCookieHeaders(response, redirect);
      return redirect;
    }
    return response;
  }

  return response;
}

/**
 * Scope the proxy to the authenticated shells only. The matcher value MUST be a
 * static string literal — Next.js statically analyzes it at build time and
 * ignores variables — so the shell prefixes are inlined here. Keep this list in
 * sync with the `is*ShellPath` predicates in `src/lib/auth/*-shell.ts` (also
 * reflected in `needsShell` above).
 *
 * The single entry matches an exact shell root or any sub-path; the leading
 * negative lookahead drops static assets nested under a shell prefix. Paths
 * outside the allow-list (`/api/*`, `/_next/*`, `favicon.ico`, public pages)
 * never match, so they skip the proxy entirely. Longer prefixes precede the
 * shorter ones they share a stem with (e.g. `family-messages` before `family`,
 * `staffing` before `staff`, `incident-draft` before `incidents`, `residents`
 * before `resident`) so the `(?:$|/)` boundary resolves to the intended shell.
 */
export const config = {
  matcher: [
    "/((?!.*\\.(?:css|js|mjs|json|txt|map|ico|png|jpg|jpeg|svg|woff2?|ttf)$)(?:admin|clinical|billing|finance|pipeline|risk|insurance|vendors|residents|resident|staffing|staff|incidents|incident-draft|schedules|time-records|payroll|certifications|training|transportation|reputation|assessments|care-plans|family-messages|family|executive|search|reports|caregiver|clock|followups|handoff|me|meds|prn-followup|tasks|dietary|med-tech|onboarding)(?:$|/).*)",
  ],
};
