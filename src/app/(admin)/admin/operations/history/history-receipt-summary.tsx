import { ReceiptSummary } from "../work/_components/receipt-history";

type Props = React.ComponentProps<typeof ReceiptSummary>;

function name(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Profile names describe the person now; recorded performer labels remain historical. */
export function HistoryReceiptSummary(props: Props) {
  const recorderName = name(props.receipt.recorder_name);
  const performerName = name(props.receipt.performer_name);
  const recordedLabel = name(props.receipt.performer_label);
  return (
    <ReceiptSummary
      {...props}
      receipt={{
        ...props.receipt,
        recorder_name: recorderName
          ? `${recorderName} (current profile name)`
          : "Name unavailable",
        performer_label:
          recordedLabel ??
          (performerName
            ? `${performerName} (current profile name)`
            : "Name unavailable"),
        performer_user_id: null,
        performer_vendor_id: null,
      }}
    />
  );
}
