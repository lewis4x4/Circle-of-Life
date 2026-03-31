import { type NextRequest } from "next/server";
import { adminShellAccessRedirect, isAdminShellPath, mergeSetCookieHeaders } from "@/lib/auth/admin-shell";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!isAdminShellPath(pathname)) {
    return response;
  }

  const redirect = adminShellAccessRedirect(request, user);
  if (!redirect) {
    return response;
  }

  mergeSetCookieHeaders(response, redirect);
  return redirect;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
