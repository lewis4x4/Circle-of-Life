import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResidentRecordPacketStart } from "./ResidentRecordPacketStart";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const INTAKE_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function snapshot(revision = REVISION) {
  return {
    intake: {
      id: INTAKE_ID,
      facility_id: "44444444-4444-4444-8444-444444444444",
      resident_id: null,
      admission_case_id: null,
      title: "Homewood resident packet",
      state: "ready_to_parse",
      parser_state: "ready",
      revision,
    },
    sources: [], facts: [], matches: [], checklist: [], counts: {},
    can: { read: true, manage: true, clinical: false, payer: true, legal: true },
  };
}

describe("ResidentRecordPacketStart", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let uuidCounter = 1;

  beforeEach(() => {
    mocks.push.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: () => `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, "0")}`,
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
    });
    uuidCounter = 1;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uploads every selected document independently before opening the durable workspace", async () => {
    let sourceIndex = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/resident-record-intakes" && init?.method === "POST") return json(snapshot());
      if (url.endsWith("/sources") && init?.method === "POST") {
        sourceIndex += 1;
        return json({ source: { id: sourceIndex === 1 ? SOURCE_ID : "55555555-5555-4555-8555-555555555555" }, upload: { signedUrl: `https://storage.example/${sourceIndex}` } });
      }
      if (url.startsWith("https://storage.example/")) return new Response(null, { status: 200 });
      if (url.endsWith("/finalize") && init?.method === "POST") return json({ source: { id: SOURCE_ID, state: "finalized" } });
      if (url === `/api/admin/resident-record-intakes/${INTAKE_ID}`) return json(snapshot());
      throw new Error(`Unexpected request ${url}`);
    });

    const user = userEvent.setup();
    render(<ResidentRecordPacketStart facilityId="44444444-4444-4444-8444-444444444444" facilityName="Homewood Lodge" />);
    await user.upload(screen.getByLabelText("Resident packet documents"), [
      new File(["first"], "face-sheet.pdf", { type: "application/pdf" }),
      new File(["second"], "insurance.png", { type: "image/png" }),
    ]);
    expect(screen.getByText("2 selected · 0 confirmed")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start packet review" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/admin/admissions/intake/${INTAKE_ID}`));
    const sourceRequests = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/sources") && init?.method === "POST");
    expect(sourceRequests).toHaveLength(2);
    const bodies = sourceRequests.map(([, init]) => JSON.parse(String(init?.body)) as { file_name: string; request_key: string });
    expect(bodies.map((body) => body.file_name)).toEqual(["face-sheet.pdf", "insurance.png"]);
    expect(new Set(bodies.map((body) => body.request_key)).size).toBe(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("https://storage.example/"))).toHaveLength(2);
  });

  it("rejects unsupported and oversized files without sending them", async () => {
    render(<ResidentRecordPacketStart facilityId="44444444-4444-4444-8444-444444444444" />);
    const dropArea = screen.getByText("Drop the full packet here").parentElement?.parentElement;
    expect(dropArea).not.toBeNull();
    fireEvent.drop(dropArea as HTMLElement, { dataTransfer: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a PDF, JPEG, PNG, WebP, HEIC, or HEIF file");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
