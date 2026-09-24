import { FloorCheckScreen } from "@/components/floor/FloorCheckScreen";

/** `/floor/check/[taskId]`: chart one check (spec 40 §6 screen 5). */
export default async function FloorCheckPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <FloorCheckScreen taskId={taskId} />;
}
