import { type NextRequest } from "next/server";
import { adminShellAccessRedirect, isAdminShellPath, mergeSetCookieHeaders } from "@/lib/auth/admin-shell";
import { caregiverShellAccessRedirect, isCaregiverShellPath } from "@/lib/auth/caregiver-shell";
import { familyShellAccessRedirect, isFamilyShellPath } from "@/lib/auth/family-shell";
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

  if (isFamilyShellPath(pathname)) {
    const redirect = familyShellAccessRedirect(request, user);
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
