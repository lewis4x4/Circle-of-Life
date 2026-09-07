import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ facilities: [{ id: "facility", name: "Synthetic facility" }], eq: vi.fn(), textSearch: vi.fn(), limit: vi.fn() }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: (selector: (s: { availableFacilities: typeof mocks.facilities }) => unknown) => selector({ availableFacilities: mocks.facilities }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const builder = { select: vi.fn(() => builder), eq: mocks.eq, textSearch: mocks.textSearch, limit: mocks.limit };
  mocks.eq.mockReturnValue(builder); mocks.textSearch.mockReturnValue(builder);
  return { from: vi.fn(() => builder) };
} }));
import Page from "./page";
const resident = (label: string) => ({ id: label, source_table: "residents", source_id: "resident", label, facility_id: "facility", updated_at: "2026-09-07" });
beforeEach(() => { vi.clearAllMocks(); mocks.limit.mockReset().mockResolvedValue({ data: [], error: null }); });
afterEach(cleanup);
function search(text: string) { fireEvent.change(screen.getByRole("textbox", { name: "Unified search query" }), { target: { value: text } }); }
describe("truthful supported search", () => {
  it("explains resident-only indexing and links to the existing specialist modules", () => {
    render(<Page />);
    expect(screen.getByText(/Resident names are searched here/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Staff.*Open staff search/i }).getAttribute("href")).toBe("/admin/staff");
    expect(screen.getByRole("link", { name: /Vendors.*Open vendor directory/i }).getAttribute("href")).toBe("/admin/vendors/directory");
    expect(screen.getByRole("link", { name: /Incidents.*Open incident records/i }).getAttribute("href")).toBe("/admin/incidents");
    expect(screen.getByPlaceholderText("Search resident names…")).toBeTruthy();
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("queries only maintained resident sources and gives a source-specific empty result", async () => {
    render(<Page />); search("Synthetic");
    await waitFor(() => expect(mocks.limit).toHaveBeenCalled());
    expect(mocks.eq).toHaveBeenCalledWith("source_table", "residents");
    expect(mocks.textSearch).toHaveBeenCalledWith("search_tsv", "Synthetic", { type: "websearch", config: "english" });
    expect(await screen.findByText("No matching residents")).toBeTruthy();
    expect(screen.queryByText("No matches")).toBeNull();
  });
  it("shows resident record navigation and facility identity", async () => {
    mocks.limit.mockResolvedValue({ data: [resident("Synthetic Person")], error: null });
    render(<Page />); search("Synthetic");
    expect((await screen.findByRole("link", { name: "Synthetic Person" })).getAttribute("href")).toBe("/admin/residents/resident");
    expect(screen.getByText("Synthetic facility")).toBeTruthy();
  });
  it("keeps retrieval failure distinct from an empty result and supports retry", async () => {
    mocks.limit.mockResolvedValueOnce({ data: null, error: { message: "Unavailable" } }).mockResolvedValue({ data: [], error: null });
    render(<Page />); search("Synthetic");
    await screen.findByText("Search failed.");
    expect(screen.queryByText("No matching residents")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("No matching residents");
  });
  it("discards a late response for an obsolete search", async () => {
    let resolveOld!: (v: { data: ReturnType<typeof resident>[]; error: null }) => void;
    mocks.limit.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; })).mockResolvedValue({ data: [resident("Current result")], error: null });
    render(<Page />); search("Old");
    await waitFor(() => expect(mocks.limit).toHaveBeenCalledOnce());
    search("Current");
    await screen.findByRole("link", { name: "Current result" });
    await act(async () => { resolveOld({ data: [resident("Obsolete result")], error: null }); });
    await waitFor(() => expect(screen.queryByText("Obsolete result")).toBeNull());
    expect(screen.getByRole("link", { name: "Current result" })).toBeTruthy();
  });
});

describe("equivalent query edits", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function debounce() {
    await act(async () => { await vi.advanceTimersByTimeAsync(320); });
  }

  it("preserves settled results when only surrounding whitespace changes", async () => {
    mocks.limit.mockResolvedValue({ data: [resident("Synthetic Person")], error: null });
    render(<Page />); search("Synthetic");
    await debounce();
    expect(screen.getByRole("link", { name: "Synthetic Person" })).toBeTruthy();

    search(" Synthetic \t");
    expect(screen.queryByRole("link", { name: "Synthetic Person" })).not.toBeNull();
    await debounce();
    expect(mocks.limit).toHaveBeenCalledOnce();
    expect(screen.queryByText("No matching residents")).toBeNull();
  });

  it("preserves an in-flight request when only surrounding whitespace changes", async () => {
    let resolve!: (value: { data: ReturnType<typeof resident>[]; error: null }) => void;
    mocks.limit.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<Page />); search("Synthetic");
    await debounce();

    search("Synthetic ");
    expect(screen.queryByText("No matching residents")).toBeNull();
    await act(async () => { resolve({ data: [resident("Synthetic Person")], error: null }); });
    await debounce();
    expect(mocks.limit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "Synthetic Person" })).not.toBeNull();
  });

  it("replaces settled results after editing away and returning before debounce", async () => {
    mocks.limit.mockResolvedValueOnce({ data: [resident("Initial Person")], error: null })
      .mockResolvedValue({ data: [resident("Updated Person")], error: null });
    render(<Page />); search("Synthetic");
    await debounce();
    expect(screen.getByRole("link", { name: "Initial Person" })).toBeTruthy();

    search("Syntheti");
    search("Synthetic");
    await debounce();
    expect(mocks.limit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("link", { name: "Updated Person" })).not.toBeNull();
    expect(screen.queryByText("No matching residents")).toBeNull();
  });

  it("replaces a canceled in-flight request after returning before debounce and ignores its late response", async () => {
    let resolveOld!: (value: { data: ReturnType<typeof resident>[]; error: null }) => void;
    mocks.limit.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockResolvedValue({ data: [resident("Current Person")], error: null });
    render(<Page />); search("Synthetic");
    await debounce();

    search("Syntheti");
    search("Synthetic");
    await debounce();
    expect(mocks.limit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("link", { name: "Current Person" })).not.toBeNull();

    await act(async () => { resolveOld({ data: [resident("Obsolete Person")], error: null }); });
    expect(screen.queryByRole("link", { name: "Obsolete Person" })).toBeNull();
    expect(screen.getByRole("link", { name: "Current Person" })).toBeTruthy();
    expect(screen.queryByText("No matching residents")).toBeNull();
  });
});
