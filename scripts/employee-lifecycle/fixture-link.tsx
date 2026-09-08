import type { AnchorHTMLAttributes } from "react";
// Only Next navigation is adapted; the production employee component and CSS are unchanged.
export default function FixtureLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
