/** Test-only: the mocked `next/navigation` state the kiosk tests drive. No imports, so a vi.mock factory can load it. */
import { vi } from "vitest";

const replace = vi.fn();
const push = vi.fn();

/** `router` is one object, as Next's is, so effects that depend on it do not rerun every render. */
export const navigation = { pathname: "/kiosk", replace, push, router: { replace, push } };
