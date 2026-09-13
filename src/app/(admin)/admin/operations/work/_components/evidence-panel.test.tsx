import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";

import type {
  EvidenceRule,
  WorkspaceReceipt,
} from "@/lib/operations/workspace";
import { EvidencePanel } from "./evidence-panel";

vi.mock("@/lib/operations/md5", () => ({
  md5OfBlob: vi.fn(async () => "0123456789abcdef0123456789abcdef"),
}));

const rule: EvidenceRule = {
  kind: "photo",
  label: "Gauge photo",
  min_count: 1,
  when: "on_success",
};
const receipt: WorkspaceReceipt = {
  id: "receipt-1",
  outcome: "performed",
  evidence_status_current: "missing",
  evidence_satisfied_at: null,
  missing_evidence: [rule],
  revision: "a".repeat(64),
};
const file = () =>
  new File(["photo bytes"], "gauge.png", { type: "image/png" });
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const fetchMock = vi.fn<typeof fetch>();
const onResult = vi.fn();
const props = () => ({
  receipt,
  rules: [rule],
  actorId: "actor-1",
  actorName: "Dana Reyes",
  onResult,
});

function success() {
  fetchMock
    .mockResolvedValueOnce(
      response({
        evidence: { id: "evidence-1", state: "prepared" },
        upload: { signedUrl: "https://storage.example.test/signed-upload" },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(
      response({ evidence: { id: "evidence-1", state: "uploaded" } }),
    )
    .mockResolvedValueOnce(
      response({
        evidence: { id: "evidence-1", state: "finalized" },
        satisfaction: {
          receipt_evidence_status: "complete",
          occurrence: {
            id: "occurrence-1",
            status: "completed",
            execution_state: "completed",
          },
        },
      }),
    );
}

beforeEach(() => {
  fetchMock.mockReset();
  onResult.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("conditional verified evidence", () => {
  it("renders nothing when the receipt requires no evidence or evidence is already complete", () => {
    const { container, rerender } = render(
      <EvidencePanel
        {...props()}
        receipt={{ ...receipt, evidence_status_current: "not_required" }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <EvidencePanel
        {...props()}
        receipt={{ ...receipt, evidence_status_current: "complete" }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hashes then prepares, puts, verifies and finalizes against the receipt revision", async () => {
    success();
    const user = userEvent.setup();
    const { container } = render(<EvidencePanel {...props()} />);
    await user.upload(screen.getByLabelText("File for Gauge photo"), file());
    await user.click(screen.getByRole("button", { name: "Upload evidence" }));
    await screen.findByText("Evidence finalized by the server.");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [prepareUrl, prepareOptions] = fetchMock.mock.calls[0];
    expect(prepareUrl).toBe("/api/admin/operations/evidence");
    expect(JSON.parse(String(prepareOptions?.body))).toMatchObject({
      receipt_id: receipt.id,
      payload: {
        kind: "photo",
        rule_label: rule.label,
        filename: "gauge.png",
        md5: "0123456789abcdef0123456789abcdef",
      },
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      credentials: "omit",
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      "/api/admin/operations/evidence/evidence-1/uploaded",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toMatchObject({
      expected_receipt_revision: receipt.revision,
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][0].satisfaction.occurrence.status).toBe(
      "completed",
    );
    expect(container.textContent).not.toContain("signed-upload");
    expect(
      screen.getByRole("button", { name: "Evidence finalized" }),
    ).toHaveFocus();
  });

  it("shows durable checksum failure and offers a different file without finalizing", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          evidence: { id: "evidence-1", state: "prepared" },
          upload: { signedUrl: "https://storage.example.test/signed-upload" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        response(
          {
            error: "Checksum mismatch: evidence failed",
            evidence: {
              id: "evidence-1",
              state: "failed",
              failure_reason: "checksum_mismatch",
            },
          },
          409,
        ),
      );
    const user = userEvent.setup();
    render(<EvidencePanel {...props()} />);
    await user.upload(screen.getByLabelText("File for Gauge photo"), file());
    await user.click(screen.getByRole("button", { name: "Upload evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Checksum mismatch",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onResult).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try another file" }));
    expect(screen.getByLabelText("File for Gauge photo")).toBeEnabled();
    expect(screen.getByLabelText("File for Gauge photo")).toHaveFocus();
  });

  it("reuses the same prepare key after a lost answer", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    const user = userEvent.setup();
    render(<EvidencePanel {...props()} />);
    await user.upload(screen.getByLabelText("File for Gauge photo"), file());
    await user.click(screen.getByRole("button", { name: "Upload evidence" }));
    await screen.findByText("network");
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    success();
    await user.click(
      screen.getByRole("button", { name: "Retry the same attachment" }),
    );
    await screen.findByText("Evidence finalized by the server.");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(first);
  });

  it("checks the stored bytes after a lost PUT answer instead of declaring failure", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          evidence: { id: "evidence-1", state: "prepared" },
          upload: { signedUrl: "https://storage.example.test/signed-upload" },
        }),
      )
      .mockRejectedValueOnce(new TypeError("lost PUT"))
      .mockResolvedValueOnce(
        response({ evidence: { id: "evidence-1", state: "uploaded" } }),
      )
      .mockResolvedValueOnce(
        response({ evidence: { id: "evidence-1", state: "finalized" } }),
      );
    const user = userEvent.setup();
    render(<EvidencePanel {...props()} />);
    await user.upload(screen.getByLabelText("File for Gauge photo"), file());
    await user.click(screen.getByRole("button", { name: "Upload evidence" }));
    await screen.findByText("Evidence finalized by the server.");
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("drops an in-flight upload on actor switch", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(<EvidencePanel {...props()} />);
    await user.upload(screen.getByLabelText("File for Gauge photo"), file());
    await user.click(screen.getByRole("button", { name: "Upload evidence" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(
      <EvidencePanel
        {...props()}
        actorId="actor-2"
        actorName="Another person"
      />,
    );
    await act(async () => {
      resolve(
        response({
          evidence: { id: "evidence-1", state: "prepared" },
          upload: { signedUrl: "https://storage.example.test/signed-upload" },
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.getByText("Another person")).toBeVisible();
    expect(screen.queryByText("Dana Reyes")).toBeNull();
  });

  it("attaches allowlisted linked records without inventing file bytes", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        evidence: { id: "linked-1", state: "finalized" },
        satisfaction: { receipt_evidence_status: "complete" },
      }),
    );
    const linkedRule = {
      ...rule,
      kind: "linked_record",
      label: "Inspection record",
    };
    const user = userEvent.setup();
    render(
      <EvidencePanel
        {...props()}
        receipt={{ ...receipt, missing_evidence: [linkedRule] }}
      />,
    );
    expect(screen.queryByLabelText(/File for/)).toBeNull();
    await user.type(
      screen.getByLabelText("Record identifier"),
      "11111111-1111-4111-8111-111111111111",
    );
    await user.click(screen.getByRole("button", { name: "Attach record" }));
    await screen.findByText("Evidence finalized by the server.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows replacement after a terminal linked-record refusal rather than locking an invalid reference", async () => {
    fetchMock.mockResolvedValueOnce(
      response(
        {
          outcome: "conflict",
          error: "Linked record is not readable for this receipt",
        },
        409,
      ),
    );
    const linkedRule = {
      ...rule,
      kind: "linked_record",
      label: "Inspection record",
    };
    const user = userEvent.setup();
    render(
      <EvidencePanel
        {...props()}
        receipt={{ ...receipt, missing_evidence: [linkedRule] }}
      />,
    );
    await user.type(
      screen.getByLabelText("Record identifier"),
      "11111111-1111-4111-8111-111111111111",
    );
    await user.click(screen.getByRole("button", { name: "Attach record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not readable");
    await user.click(
      screen.getByRole("button", { name: "Try another record" }),
    );
    expect(screen.getByLabelText("Record identifier")).toBeEnabled();
    expect(screen.getByLabelText("Record identifier")).toHaveValue("");
    expect(onResult).not.toHaveBeenCalled();
  });

  it("keeps unsupported reading requirements unmet and passes structural axe", async () => {
    const { container } = render(
      <EvidencePanel
        {...props()}
        receipt={{
          ...receipt,
          missing_evidence: [{ ...rule, kind: "reading" }],
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "requirement remains unmet",
    );
    expect(screen.queryByRole("button")).toBeNull();
    const result = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
        region: { enabled: false },
      },
    });
    expect(result.violations).toEqual([]);
  });

  it("rejects a file above the declared byte limit before preparing", async () => {
    const large = file();
    Object.defineProperty(large, "size", { value: MAX_TEST_BYTES });
    render(<EvidencePanel {...props()} />);
    fireEvent.change(screen.getByLabelText("File for Gauge photo"), {
      target: { files: [large] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload evidence" }));
    await screen.findByText(
      "Choose a PDF, JPEG, PNG or WebP file up to 20 MB.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const MAX_TEST_BYTES = 20 * 1024 * 1024 + 1;
