import { ResidentRecordPacketWorkspace } from "@/components/resident-intake";

type ResidentRecordPacketPageProps = { params: Promise<{ id: string }> };

export default async function ResidentRecordPacketPage({ params }: ResidentRecordPacketPageProps) {
  const { id } = await params;
  return <ResidentRecordPacketWorkspace intakeId={id} />;
}
