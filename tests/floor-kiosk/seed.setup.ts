import { test as setup } from "@playwright/test";

import { FLOOR_KIOSK_ENABLED, demo, runSeed } from "./_helpers";

/**
 * The floor-kiosk project's setup step: re-seed the fidelity demo on Haven HFO
 * Staging so every run starts from the rendered state (checks uncharted,
 * visits open, Jordan off the clock, no tablet unlocked). The seed refuses to
 * run against anything but staging.
 */
setup("seed the fidelity demo on staging", () => {
  setup.skip(!FLOOR_KIOSK_ENABLED, "FLOOR_KIOSK_E2E is not set.");
  setup.setTimeout(300_000);
  runSeed();
  demo();
});
