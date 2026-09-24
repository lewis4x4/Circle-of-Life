/**
 * The public site's front page. The apex `/` is the staff sign-in by decision
 * (commit 5ec4b92e), so anything that means "back to the public site" — the
 * sign-in page's way back, the public header's logo — goes here instead of `/`,
 * which would loop a visitor into sign-in (COL-662).
 */
export const PUBLIC_SITE_HOME_HREF = "/campuses";
