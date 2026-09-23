/**
 * UI-V2 feature flag. The `/admin/v2/*` route tree it used to rewrite into was a set of
 * re-exports of the `/admin/*` pages and was retired in COL-654 (the old URLs 308 to
 * their `/admin/*` equivalents; see `src/lib/routing/legacy-redirects.ts`). The flag now
 * gates only the design-system preview at `/admin/v2/design-preview` and the unused
 * `V2*Page` wrappers. `NEXT_PUBLIC_UI_V2=false` (production) turns them off; any other
 * value — including absent — leaves them on.
 */
export function uiV2(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_UI_V2 !== "false";
}
