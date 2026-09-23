"use client";

import { useCallback, useRef } from "react";

/**
 * Latest-read-wins for a page's load callback (COL-406, COL-673, COL-682).
 *
 * Cookie-bootstrapped admin clients reload whenever the facility store changes.
 * During hydration the store first reads its pre-hydration `null`, then the
 * persisted facility, and both load effects can flush in the same task. An
 * earlier read that settles later (typically the unscoped one, which fails at
 * once with "Select a facility.") must not overwrite what the newer read shows.
 *
 * Call `beginLoad()` at the start of each read; after every `await`, and in
 * `catch`/`finally`, write state only while the returned `isCurrent()` is true.
 */
export function useLatestLoad(): () => () => boolean {
  const sequenceRef = useRef(0);
  return useCallback(() => {
    const sequence = ++sequenceRef.current;
    return () => sequence === sequenceRef.current;
  }, []);
}
