import { type NextRequest, NextResponse } from "next/server";
import { adminShellAccessRedirect, isAdminShellPath, mergeSetCookieHeaders } from "@/lib/auth/admin-shell";
import { caregiverShellAccessRedirect, isCaregiverShellPath } from "@/lib/auth/caregiver-shell";
import { dietaryShellAccessRedirect, isDietaryShellPath } from "@/lib/auth/dietary-shell";
import { familyShellAccessRedirect, isFamilyShellPath } from "@/lib/auth/family-shell";
import { isMedTechShellPath, medTechShellAccessRedirect } from "@/lib/auth/med-tech-shell";
import { isOnboardingShellPath, onboardingShellAccessRedirect } from "@/lib/auth/onboarding-shell";
import { resolveUiV2AdminRewritePath } from "@/lib/flags";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

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

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
