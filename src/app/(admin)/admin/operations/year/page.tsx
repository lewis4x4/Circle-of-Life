import { OperationsTaskRangePage } from "@/components/operations/OperationsTaskRangePage";

export default function YearlyTasksPage() {
  return (
    <OperationsTaskRangePage
      view="year"
      title="Yearly Tasks"
      category="yearly_rounds"
      iconName="building"
      iconWrapClassName="bg-indigo-100"
      iconClassName="text-indigo-700"
    />
  );
}
