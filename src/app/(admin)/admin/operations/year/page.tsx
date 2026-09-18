import { OperationsTaskRangePage } from "@/components/operations/OperationsTaskRangePage";

export default function YearlyTasksPage() {
  return (
    <OperationsTaskRangePage
      view="year"
      title="Yearly Tasks"
      category="yearly_rounds"
      iconName="building"
      iconWrapClassName="bg-primary/10"
      iconClassName="text-primary"
    />
  );
}
