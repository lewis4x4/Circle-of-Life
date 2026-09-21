"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BENEFITS_STAGES,
  type BenefitsCommand,
  type BenefitsDetail,
} from "@/lib/benefits/contracts";
import {
  ActionForm,
  dateLabel,
  ErrorNotice,
  label,
  Panel,
} from "./benefits-ui";

type Command = (
  action: BenefitsCommand["action"],
  payload: Record<string, unknown>,
  requestId: string,
) => Promise<void>;
export function BenefitsSubmissions({
  detail,
  command,
  disabled,
}: {
  detail: BenefitsDetail;
  command: Command;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [packetError, setPacketError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accepted = new Set(
    detail.requirements
      .filter(
        (requirement) =>
          requirement.status === "accepted" &&
          requirement.document_id &&
          requirement.signature_status !== "pending",
      )
      .map((requirement) => requirement.document_id),
  );
  const docs = detail.documents.filter(
    (document) => document.status === "ready" && accepted.has(document.id),
  );
  const selectedIds = selected.filter((id) =>
    docs.some((document) => document.id === id),
  );
  const base = `/api/admin/benefits/cases/${detail.case.id}`;
  return (
    <>
      <Panel
        title="Prepare a reviewed packet"
        description="Select accepted evidence for this submission. Export includes a case cover, checklist, manifest, and the original files. Confirm each recipient’s current form and signature requirements before sending. Exporting does not send documents or record agency receipt."
      >
        <fieldset disabled={disabled || busy} className="space-y-2">
          {docs.map((document) => (
            <label
              key={document.id}
              className="flex min-h-11 items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(document.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, document.id]
                      : current.filter((id) => id !== document.id),
                  )
                }
              />
              {document.filename} · {document.document_type}
            </label>
          ))}
        </fieldset>
        {!docs.length && (
          <p className="text-sm text-muted-foreground">
            No accepted evidence is ready. Review requirements and any actual
            signatures first.
          </p>
        )}
        <ErrorNotice error={packetError} />
        <Button
          className="min-h-11"
          variant="outline"
          disabled={disabled || busy || !selectedIds.length}
          onClick={async () => {
            setBusy(true);
            setPacketError(null);
            try {
              const response = await fetch(`${base}/packet`, {
                method: "POST",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  document_ids: selectedIds,
                  expected_revision: detail.case.revision,
                }),
              });
              if (!response.ok) {
                const result = await response.json().catch(() => null);
                throw new Error(
                  result?.error ||
                    "Packet could not be verified. Refresh the case and review selected evidence.",
                );
              }
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `benefits-packet-${detail.case.id}.zip`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (caught) {
              setPacketError(
                caught instanceof Error
                  ? caught.message
                  : "Unable to export packet.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Preparing packet…"
            : `Download reviewed packet (${selectedIds.length} files)`}
        </Button>
      </Panel>
      <ActionForm
        title="Record actual submission"
        description="Record only after you have sent the selected evidence through the approved channel. Required items for this stage must be accepted or have a reviewed not-applicable reason."
        disabled={disabled || busy || selectedIds.length === 0}
        submitLabel="Record sent submission"
        fields={[
          {
            name: "stage",
            label: "Submission stage",
            type: "select",
            required: true,
            options: BENEFITS_STAGES.map((value) => ({
              value,
              label: label(value),
            })),
          },
          {
            name: "destination",
            label: "Recipient or destination",
            required: true,
          },
          {
            name: "method",
            label: "Delivery method",
            type: "select",
            required: true,
            options: ["fax", "portal", "mail", "secure_email", "in_person"].map(
              (value) => ({ value, label: label(value) }),
            ),
          },
          {
            name: "sent_at",
            label: "Actual sent time (Eastern)",
            type: "datetime-local",
            required: true,
          },
          {
            name: "external_reference",
            label: "Submission confirmation or reference",
          },
          { name: "notes", label: "Submission notes", type: "textarea" },
        ]}
        onSubmit={(payload, requestId) =>
          command(
            "record_submission",
            {
              ...payload,
              external_reference: payload.external_reference ?? "",
              notes: payload.notes ?? "",
              document_ids: selectedIds,
            },
            requestId,
          )
        }
      />
      <Panel title="Submission and receipt history">
        {!detail.submissions.length && (
          <p className="text-sm text-muted-foreground">
            No sent submissions recorded.
          </p>
        )}
        <ul className="space-y-5">
          {detail.submissions.map((submission) => (
            <li
              key={submission.id}
              className="space-y-3 border-b border-border pb-5"
            >
              <p className="font-medium">
                {label(submission.stage)} · {submission.destination}
              </p>
              <p className="text-sm">
                Sent {dateLabel(submission.sent_at)} via{" "}
                {label(submission.method)} ·{" "}
                {submission.external_reference || "No external reference"}
              </p>
              <p className="text-xs text-muted-foreground">
                Recorded {dateLabel(submission.created_at)}
              </p>
              <ul className="list-inside list-disc text-sm">
                {submission.manifest.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`${base}/documents/${entry.id}`}
                      download
                      className="underline"
                    >
                      {entry.filename}
                    </a>
                  </li>
                ))}
              </ul>
              {detail.receipts
                .filter((receipt) => receipt.submission_id === submission.id)
                .map((receipt) => (
                  <div
                    key={receipt.id}
                    className="rounded-[var(--radius)] bg-muted/40 p-3 text-sm"
                  >
                    <p>
                      Agency receipt: {dateLabel(receipt.received_at)} ·{" "}
                      {receipt.source_reference || "No reference"}
                    </p>
                    {receipt.notes && <p>{receipt.notes}</p>}
                    {receipt.document_id && (
                      <a
                        href={`${base}/documents/${receipt.document_id}`}
                        download
                        className="inline-flex min-h-11 items-center underline"
                      >
                        Download receipt evidence
                      </a>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Recorded {dateLabel(receipt.created_at)}
                    </p>
                  </div>
                ))}
              {!detail.receipts.some(
                (receipt) => receipt.submission_id === submission.id,
              ) && (
                <p className="text-sm text-muted-foreground">
                  Receipt not yet recorded.
                </p>
              )}
              <details>
                <summary className="min-h-11 cursor-pointer text-sm underline">
                  Record agency receipt
                </summary>
                <ActionForm
                  title="Agency receipt"
                  disabled={disabled}
                  submitLabel="Record receipt"
                  fields={[
                    {
                      name: "received_at",
                      label: "Agency received time (Eastern)",
                      type: "datetime-local",
                      required: true,
                    },
                    {
                      name: "source_reference",
                      label: "Receipt confirmation or reference",
                    },
                    {
                      name: "document_id",
                      label: "Receipt evidence",
                      type: "select",
                      options: detail.documents
                        .filter((document) => document.status === "ready")
                        .map((document) => ({
                          value: document.id,
                          label: document.filename,
                        })),
                    },
                    { name: "notes", label: "Receipt notes", type: "textarea" },
                  ]}
                  onSubmit={(payload, requestId) =>
                    command(
                      "record_receipt",
                      {
                        ...payload,
                        source_reference: payload.source_reference ?? "",
                        notes: payload.notes ?? "",
                        submission_id: submission.id,
                      },
                      requestId,
                    )
                  }
                />
              </details>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
