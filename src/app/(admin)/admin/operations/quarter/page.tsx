import { OperationsTaskRangePage } from "@/components/operations/OperationsTaskRangePage";

export default function QuarterlyTasksPage() {
  return (
    <OperationsTaskRangePage
      view="quarter"
      title="Quarterly Tasks"
      category="quarterly_rounds"
      iconName="shield-check"
      iconWrapClassName="bg-amber-100"
      iconClassName="text-amber-700"
    />
  );
}
