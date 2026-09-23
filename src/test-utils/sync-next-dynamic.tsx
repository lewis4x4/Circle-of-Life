import type { ComponentType } from "react";

/**
 * Test double for `next/dynamic` that renders the loaded component
 * synchronously once `dynamicModulesReady()` has resolved. `dynamic()` is
 * called when the page module is imported, so every loader has started by the
 * time a test file's `beforeAll` runs.
 *
 *   vi.mock("next/dynamic", async () => (await import("@/test-utils/sync-next-dynamic")).nextDynamicMock);
 *   beforeAll(() => dynamicModulesReady());
 */
const pending: Promise<unknown>[] = [];

type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };

function dynamic<P extends object>(loader: () => Promise<Loaded<P>>): ComponentType<P> {
  let Resolved: ComponentType<P> | null = null;
  pending.push(
    loader().then((loaded) => {
      Resolved = "default" in loaded ? loaded.default : loaded;
    }),
  );
  function SyncDynamic(props: P) {
    return Resolved ? <Resolved {...props} /> : null;
  }
  return SyncDynamic;
}

export const nextDynamicMock = { __esModule: true, default: dynamic };

export function dynamicModulesReady(): Promise<unknown[]> {
  return Promise.all(pending);
}
