import PacketDetail from "@/components/payroll-packets/PacketDetail";
export default async function PayrollPacketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PacketDetail id={id} />;
}
