import { expect, test } from "@playwright/test";

import { adminClient, facilityId, roleClient, signIn, skipUnlessEnabled } from "./_helpers";

/**
 * Spec 25A acceptance item 4: a chip composed observation succeeds with an
 * empty free text note and stores a non-empty `composed_summary`.
 *
 * Both halves matter and the second is the one that regresses. Decision 4 made
 * chips required and the note optional, and every version of this capture
 * surface before it either required free text or produced an empty narrative
 * when none arrived. The assertion is therefore on the stored column and not on
 * what the screen echoed back.
 *
 * This test writes an observation log, and observation logs are immutable:
 * migration 331 puts a BEFORE UPDATE trigger on the table that refuses every
 * update from every role, so the row this leaves behind cannot be withdrawn.
 * Run this project against a project where that is acceptable. It is the one
 * spec in the project that writes clinical evidence.
 */
skipUnlessEnabled();

test.describe("chip composed capture", () => {
  test("a chip composed check records with an empty note and stores a composed narrative", async ({ page }) => {
    const admin = adminClient();
    const facility = facilityId();
    const caregiver = await roleClient("caregiver");

    // The caregiver's own open task, on their own authority, so the test cannot
    // reach a task the surface would not offer them.
    const { data: tasks, error: tasksError } = await caregiver.client
      .from("resident_observation_tasks")
      .select("id, resident_id, status")
      .eq("facility_id", facility)
      .in("status", ["due_now", "due_soon", "overdue"])
      .is("deleted_at", null)
      .order("due_at", { ascending: true })
      .limit(1);
    if (tasksError) throw new Error(`task read failed: ${tasksError.message}`);
    const task = tasks?.[0];
    if (!task) {
      // A hard failure, not a skip. An empty board means the generator has not
      // run against this project, which is the thing the acceptance run is
      // there to notice.
      throw new Error(
        `no open observation task for the caregiver at facility ${facility}. Run observation-task-generator against the target project before this suite.`,
      );
    }

    await signIn(page, "caregiver");
    await page.goto(`/caregiver/rounds/${task.resident_id}?taskId=${task.id}`);

    // One tap per required group. Every chip label comes from
    // observation_vocab, so the test takes whichever chip the building offers
    // first rather than naming one.
    for (const group of ["Status", "Where", "How they presented", "Meals", "Mood", "Medications"]) {
      const row = page.getByRole(group === "Meals" || group === "Mood" || group === "Medications" ? "group" : "radiogroup", {
        name: group,
      });
      await expect(row, `the ${group} chip group did not render`).toBeVisible();
      await row.getByRole(group === "Meals" || group === "Mood" || group === "Medications" ? "checkbox" : "radio").first().click();
    }

    // The note stays empty. This is the assertion, not an omission.
    const note = page.getByLabel(/Note, if there is something to add/i);
    await expect(note).toHaveValue("");

    const preview = page.getByTestId("observation-preview");
    await expect(preview).not.toBeEmpty();

    const record = page.getByRole("button", { name: /Record check/i });
    await expect(record).toBeEnabled();
    await record.click();

    // The stored row is the proof. The preview is a rendering of a draft; the
    // column is what an inspector reads.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("resident_observation_logs")
            .select("id, note, composed_summary, chip_selections")
            .eq("task_id", task.id)
            .is("deleted_at", null)
            .maybeSingle();
          return data ?? null;
        },
        { timeout: 30_000, message: "no observation log was written for the task" },
      )
      .not.toBeNull();

    const { data: written } = await admin
      .from("resident_observation_logs")
      .select("note, composed_summary, chip_selections")
      .eq("task_id", task.id)
      .is("deleted_at", null)
      .maybeSingle();

    expect(written?.note ?? null, "a note was stored, so this run did not exercise the empty note path").toBeNull();
    expect((written?.composed_summary ?? "").trim().length, "composed_summary is empty on a chip composed check").toBeGreaterThan(0);
    expect(Object.keys((written?.chip_selections ?? {}) as Record<string, unknown>).length, "no chip group was stored").toBeGreaterThan(0);

    // A group with no selection is absent, never present and empty (build
    // notes section 4a). An empty array in the map is a different fact from an
    // unanswered group and nothing downstream distinguishes them.
    for (const [group, codes] of Object.entries((written?.chip_selections ?? {}) as Record<string, string[]>)) {
      expect(Array.isArray(codes), `${group} is not a list of codes`).toBe(true);
      expect(codes.length, `${group} is present and empty, which should be absent instead`).toBeGreaterThan(0);
    }
  });
});
