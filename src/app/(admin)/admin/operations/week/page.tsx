import { OperationsTaskRangePage } from "@/components/operations/OperationsTaskRangePage";

export default function WeeklyTasksPage() {
  return (
    <OperationsTaskRangePage
      view="week"
      title="Weekly Tasks"
      category="weekly_rounds"
      iconName="calendar"
      iconWrapClassName="bg-blue-100"
      iconClassName="text-blue-600"
    />
  );
}
