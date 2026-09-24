import type { AnchorHTMLAttributes } from "react";
export default function FixtureLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const views: Record<string, string> = { "/admin/staffing": "today", "/admin/schedules": "schedule", "/admin/staff": "people", "/admin/timecards": "timecards" };
  return <a {...props} href={href && views[href] ? `/?view=${views[href]}` : href} />;
}
