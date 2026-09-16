import type { Locator, Page } from "@playwright/test";

import { CARE_EVENT_CALL_911_LINE, careEventSendButtonLabel } from "../../src/lib/care-events/level-copy";
import { CARE_EVENT_TILES, careEventTileByKind, type CareEventTile } from "../../src/lib/care-events/tiles";
import { formatLevelWord } from "../../src/lib/incidents/incidents-display-copy";
import {
  CAREGIVER,
  HOMEWOOD,
  adminClient,
  cleanupCareEventsForUser,
  expect,
  pickCaseForTile,
  setWorkingFacility,
  signInWithRetry,
  test,
  type LevelCase,
} from "./_helpers";

/**
 * Spec 07A section 9 item 3: walk Who, What, How bad for each of the eight
 * tiles and assert that no text input is required, the banner shows the
 * fixture's level word, and the receipt carries an incident number for
 * Level 2 and above and none for Level 1. Item 7 (idempotent replay) rides
 * on the fall test. Serial so the after-each cleanup keeps every test at
 * exactly one row for the reporter.
 *
 * Mutates: `care_events` and everything `submit_care_event` fans out into,
 * as the seeded Homewood caregiver. Cleans up after every test.
 */

const INCIDENT_NUMBER_RE = /Incident [A-Z]{2,4}-\d{4}-\d{4}/;

/** Two minutes of slack for clock skew between the test host and the database container. */
function sinceIso(start: number): string {
  return new Date(start - 2 * 60_000).toISOString();
}

type CareEventRow = {
  id: string;
  client_event_id: string;
  facility_id: string;
  resident_id: string | null;
  final_level: string;
  incident_id: string | null;
  occurred_at: string;
};

async function answerHowBad(page: Page, tile: CareEventTile, levelCase: LevelCase): Promise<void> {
  for (const question of tile.questions) {
    const answer = levelCase.answers[question.key];
    if (question.multi) {
      const values = Array.isArray(answer) ? answer : [];
      const group = page.getByRole("group", { name: question.prompt, exact: true });
      for (const value of values) {
        const option = question.options.find((candidate) => candidate.value === value);
        if (!option) throw new Error(`Fixture ${levelCase.id} answers ${question.key}=${value}, which is not a button on the tile.`);
        const button = group.getByRole("button", { name: option.label, exact: true });
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
      }
      continue;
    }
    if (typeof answer !== "string") {
      throw new Error(`Fixture ${levelCase.id} leaves single-select ${question.key} unanswered; the flow cannot send.`);
    }
    const option = question.options.find((candidate) => candidate.value === answer);
    if (!option) throw new Error(`Fixture ${levelCase.id} answers ${question.key}=${answer}, which is not a button on the tile.`);
    const radio = page.getByRole("radiogroup", { name: question.prompt, exact: true }).getByRole("radio", { name: option.label, exact: true });
    await radio.click();
    await expect(radio).toHaveAttribute("aria-checked", "true");
  }

  // Location is optional: tap the case's chip when the facility vocabulary offers it.
  const locationLabel = levelCase.context?.location_label ?? null;
  if (locationLabel) {
    const chip = page.getByRole("radiogroup", { name: "Where it happened", exact: true }).getByRole("radio", { name: locationLabel, exact: true });
    if ((await chip.count()) > 0) {
      await chip.click();
      await expect(chip).toHaveAttribute("aria-checked", "true");
    }
  }
}

async function assertNoTypingRequired(page: Page): Promise<void> {
  await expect(page.locator("textarea")).toHaveCount(0);
  const inputs = await page.locator("input").evaluateAll((elements) =>
    elements.map((element) => {
      const input = element as HTMLInputElement;
      return { type: input.type, required: input.required, hidden: input.hidden || input.type === "hidden" };
    }),
  );
  for (const input of inputs) {
    const optionalSearch = input.type === "search" && !input.required;
    const fileInput = input.type === "file";
    expect(optionalSearch || fileInput, `unexpected input on How bad: ${JSON.stringify(input)}`).toBe(true);
  }
}

async function readSingleCareEvent(userId: string, since: string): Promise<CareEventRow> {
  const supa = adminClient();
  const result = await supa
    .from("care_events")
    .select("id, client_event_id, facility_id, resident_id, final_level, incident_id, occurred_at")
    .eq("reported_by", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  expect(result.error, result.error?.message).toBeNull();
  const rows = (result.data ?? []) as CareEventRow[];
  expect(rows, "exactly one care_events row for the reporter since the test started").toHaveLength(1);
  return rows[0];
}

function howBadBanner(page: Page): Locator {
  return page.locator('section[aria-labelledby="report-how-bad-heading"] [role="status"]');
}

/**
 * The caregiver shell renders its pages only once a working facility is chosen.
 * A caregiver with more than one facility gets the header select; pick the
 * facility the same way they do when the Who step is not already on screen.
 */
async function ensureWorkingFacility(page: Page, facilityId: string): Promise<void> {
  const heading = page.getByRole("heading", { name: "Who is it about?" });
  const select = page.getByRole("combobox", { name: "Working facility" });
  const option = select.locator(`option[value="${facilityId}"]`);
  // The header loads its options once per page load and shows an error when the
  // data layer answers late; a reload is what a caregiver does, so do it a bounded
  // number of times before giving up.
  for (let round = 1; round <= 3; round += 1) {
    await expect(heading.or(select).first()).toBeVisible({ timeout: 60_000 });
    if (await heading.isVisible()) return;
    try {
      await expect(option).toHaveCount(1, { timeout: 20_000 });
      await select.selectOption(facilityId);
      return;
    } catch (error) {
      if (round === 3) throw error;
      // eslint-disable-next-line no-console
      console.warn(`[care-events] working facility options did not load (round ${round}); reloading`);
      await page.reload();
    }
  }
}

/**
 * Wait for the Who step. When the flow's data load fails (the local GoTrue or
 * PostgREST answering late), the page offers "Try again"; press it the way a
 * caregiver would, a bounded number of times, instead of failing on the first
 * slow answer.
 */
async function waitForWhoStep(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { name: "Who is it about?" });
  const tryAgain = page.getByRole("button", { name: "Try again", exact: true });
  const deadline = Date.now() + 90_000;
  let retries = 0;
  while (Date.now() < deadline) {
    if (await heading.isVisible()) return;
    if (retries < 4 && (await tryAgain.isVisible())) {
      retries += 1;
      // eslint-disable-next-line no-console
      console.warn(`[care-events] report flow data load failed; pressing Try again (${retries})`);
      await tryAgain.click();
    }
    await page.waitForTimeout(1_000);
  }
  await expect(heading).toBeVisible();
}

test.describe.serial("Something happened: three taps per tile", () => {
  const suiteStart = Date.now();
  let testStart = suiteStart;

  test.beforeEach(() => {
    testStart = Date.now();
  });

  test.afterEach(async () => {
    await cleanupCareEventsForUser(CAREGIVER.userId, sinceIso(testStart));
  });

  test.afterAll(async () => {
    await cleanupCareEventsForUser(CAREGIVER.userId, sinceIso(suiteStart));
  });

  for (const tile of CARE_EVENT_TILES) {
    const levelCase = pickCaseForTile(tile.kind);
    const level = levelCase.expect.level;
    const levelWord = formatLevelWord(level);

    test(`${tile.word}: three taps reach a ${levelWord} receipt (${levelCase.id})`, async ({ page }) => {
      // Each test drives a full sign-in and three screens through a dev server; triple the budget.
      test.slow();
      await signInWithRetry(page, CAREGIVER.email);
      await setWorkingFacility(page, CAREGIVER.userId, HOMEWOOD.facilityId);
      await page.goto("/caregiver/report");
      await ensureWorkingFacility(page, HOMEWOOD.facilityId);

      // Tap 1: Who.
      await waitForWhoStep(page);
      if (tile.residentOptional) {
        await page.getByRole("button", { name: "No resident, the building" }).click();
      } else {
        const whoSection = page.locator('section[aria-labelledby="report-who-heading"]');
        const firstResident = whoSection.locator("ul li button").first();
        await expect(firstResident).toBeVisible();
        await firstResident.click();
      }

      // Tap 2: What.
      await expect(page.getByRole("heading", { name: "What happened?" })).toBeVisible();
      const tileButton = page
        .getByRole("list", { name: "What happened" })
        .getByRole("button", { name: new RegExp(`^${tile.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) });
      await expect(tileButton).toBeEnabled();
      await tileButton.click();

      // Tap 3: How bad.
      await expect(page.getByRole("heading", { name: tile.word, exact: true })).toBeVisible();
      await answerHowBad(page, tile, levelCase);

      await assertNoTypingRequired(page);

      const banner = howBadBanner(page);
      await expect(banner).toBeVisible();
      await expect(banner.locator("p").first()).toHaveText(levelWord);

      const sendButton = page.getByRole("button", { name: careEventSendButtonLabel(level), exact: true });
      await expect(sendButton).toBeVisible();
      await expect(sendButton).toBeEnabled();

      if (levelCase.expect.flags.call_911_prompt) {
        await expect(banner).toContainText(CARE_EVENT_CALL_911_LINE);
      } else {
        await expect(banner).not.toContainText(CARE_EVENT_CALL_911_LINE);
      }

      await sendButton.click();

      // Receipt. The Level 1 banner also says "Saved to the log", so anchor on the receipt section
      // and require the online heading (the offline heading would mean the send was queued, not saved).
      // When the data layer answers late the flow keeps the event on screen with an error line and
      // an enabled send button; press it again a bounded number of times (the RPC is idempotent).
      const receipt = page.locator('section[aria-labelledby="report-receipt-heading"]');
      const sendError = page.getByRole("alert").filter({ hasText: /not sent|could not be saved/ });
      for (let resend = 0; resend < 3; resend += 1) {
        try {
          await expect(receipt.or(sendError).first()).toBeVisible({ timeout: 90_000 });
        } catch {
          break;
        }
        if (await receipt.isVisible()) break;
        // eslint-disable-next-line no-console
        console.warn(`[care-events] send was rejected by the data layer; pressing send again (${resend + 1})`);
        await sendButton.click();
      }
      await expect(receipt).toBeVisible({ timeout: 90_000 });
      await expect(receipt.getByRole("heading", { level: 2 })).toHaveText(/^Saved to /);
      const incidentLine = receipt.getByText(INCIDENT_NUMBER_RE);
      if (level >= 2) {
        await expect(incidentLine).toBeVisible();
      } else {
        await expect(incidentLine).toHaveCount(0);
      }

      // Database: one row for the reporter, the fixture's level, an incident only above Level 1.
      const row = await readSingleCareEvent(CAREGIVER.userId, sinceIso(testStart));
      expect(row.final_level).toBe(`level_${level}`);
      if (level === 1) {
        expect(row.incident_id).toBeNull();
      } else {
        expect(row.incident_id).not.toBeNull();
      }

      // Item 7, idempotent replay, rides on the fall tile.
      if (tile.kind === "fall") {
        const payload = {
          client_event_id: row.client_event_id,
          facility_id: row.facility_id,
          resident_id: row.resident_id,
          kind: tile.kind,
          answers: { ...levelCase.answers, worried: levelCase.answers.worried === true },
          occurred_at: row.occurred_at,
          note: null,
          location_code: null,
          captured_offline: true,
        };
        const receipts: { care_event_id?: string; replayed?: boolean }[] = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await page.request.post("/api/care-events/submit", { data: payload, timeout: 90_000 });
          expect(response.ok(), `replay ${attempt + 1} returned ${response.status()}: ${await response.text()}`).toBe(true);
          receipts.push((await response.json()) as { care_event_id?: string; replayed?: boolean });
        }
        for (const receipt of receipts) {
          expect(receipt.care_event_id).toBe(row.id);
          expect(receipt.replayed).toBe(true);
        }

        const supa = adminClient();
        const events = await supa
          .from("care_events")
          .select("id", { count: "exact", head: true })
          .eq("client_event_id", row.client_event_id);
        expect(events.error, events.error?.message).toBeNull();
        expect(events.count).toBe(1);
        const incidents = await supa.from("incidents").select("id", { count: "exact", head: true }).eq("id", row.incident_id ?? "");
        expect(incidents.error, incidents.error?.message).toBeNull();
        expect(incidents.count).toBe(1);
      }
    });
  }
});

// Guard against a fixture drifting away from the tile definitions: every walked case must be sendable.
for (const tile of CARE_EVENT_TILES) {
  const levelCase = pickCaseForTile(tile.kind);
  const questions = careEventTileByKind(tile.kind).questions;
  for (const question of questions) {
    if (question.multi) continue;
    if (typeof levelCase.answers[question.key] !== "string") {
      throw new Error(`Fixture ${levelCase.id} cannot be sent: ${question.key} is unanswered.`);
    }
  }
}
