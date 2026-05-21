import { redirect } from "next/navigation";

/**
 * The apex URL routes straight to the operator sign-in.
 *
 * The marketing landing (`src/components/landing/landing-home.tsx`) is kept
 * in the tree intentionally so it can be re-mounted at a marketing path
 * later, but the root URL is the staff entry point for now.
 */
export default function Home() {
  redirect("/login");
}
