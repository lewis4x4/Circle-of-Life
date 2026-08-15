import { redirect } from "next/navigation";

/** Trainers often bookmark /payments — send them to record-payment workflow. */
export default function AdminBillingPaymentsIndexPage() {
  redirect("/admin/billing/payments/new");
}
