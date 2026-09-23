import { Suspense } from "react";

import { FloorLockScreen } from "@/components/floor/FloorLockScreen";

/** `/floor/lock`: who is on shift, then their PIN (spec 40 §6 screens 1 and 2). No session. */
export default function FloorLockPage() {
  return (
    <Suspense fallback={null}>
      <FloorLockScreen />
    </Suspense>
  );
}
