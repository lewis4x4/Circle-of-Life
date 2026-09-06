import { beforeEach, describe, expect, it, vi } from "vitest";
const { save, exportDb } = vi.hoisted(() => ({ save: vi.fn(), exportDb: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}), isBrowserSupabaseConfigured: () => true }));
vi.mock("@/lib/onboarding/supabase-queries", () => ({ upsertResponse: save, exportAllAsMarkdown: exportDb, fetchQuestions: vi.fn(), fetchResponses: vi.fn(), importQuestions: vi.fn() }));
import { useOnboardingStore } from "./useOnboardingStore";
beforeEach(() => {
  useOnboardingStore.getState().clearAfterSignOut();
  useOnboardingStore.setState({ hydration: "ready", organizationId: "org", userId: "user", responsesByQuestionId: {}, questionsById: {} });
  save.mockReset().mockResolvedValue(undefined);
  exportDb.mockReset().mockResolvedValue("export");
});
describe("onboarding durable saves", () => {
  it("flushes an edit before the debounce interval when exporting", async () => {
    useOnboardingStore.getState().setResponseValue("q1", "Latest answer");
    await useOnboardingStore.getState().exportMarkdownFromDb();
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ questionId: "q1", value: "Latest answer" }));
    expect(exportDb).toHaveBeenCalledTimes(1);
  });
  it("retains an error from one question when another saves", async () => {
    save.mockImplementation(async (_client, args) => { if (args.questionId === "q1") throw new Error("Unavailable"); });
    useOnboardingStore.getState().setResponseValue("q1", "Draft one");
    useOnboardingStore.getState().setResponseValue("q2", "Draft two");
    await expect(useOnboardingStore.getState().exportMarkdownFromDb()).rejects.toThrow();
    expect(useOnboardingStore.getState().saveStatus).toBe("error");
    expect(useOnboardingStore.getState().responsesByQuestionId.q1?.value).toBe("Draft one");
    expect(exportDb).not.toHaveBeenCalled();
  });
});

it("persists the newest edit after an overlapping older save", async () => {
  let release!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
  useOnboardingStore.getState().setResponseValue("q1", "Earlier answer");
  const first = useOnboardingStore.getState().flushPending();
  useOnboardingStore.getState().setResponseValue("q1", "Newest answer");
  const second = useOnboardingStore.getState().flushPending();
  release();
  await Promise.all([first, second]);
  expect(save).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ value: "Newest answer" }));
  expect(useOnboardingStore.getState().saveStatus).toBe("saved");
});
