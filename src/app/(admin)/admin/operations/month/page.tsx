import { OperationsTaskRangePage } from "@/components/operations/OperationsTaskRangePage";

export default function MonthlyTasksPage() {
  return (
    <OperationsTaskRangePage
      view="month"
      title="Monthly Tasks"
      category="monthly_rounds"
      iconName="file-text"
      iconWrapClassName="bg-primary-100"
      iconClassName="text-primary-700"
    />
  );
}
