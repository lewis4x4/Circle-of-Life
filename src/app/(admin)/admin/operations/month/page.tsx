import { OperationsTaskRangePage } from "@/components/operations/OperationsTaskRangePage";

export default function MonthlyTasksPage() {
  return (
    <OperationsTaskRangePage
      view="month"
      title="Monthly Tasks"
      category="monthly_rounds"
      iconName="file-text"
      iconWrapClassName="bg-violet-100"
      iconClassName="text-violet-700"
    />
  );
}
