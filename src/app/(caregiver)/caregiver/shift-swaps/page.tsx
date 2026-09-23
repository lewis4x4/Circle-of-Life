import { MyShiftSwaps } from "@/components/caregiver/MyShiftSwaps";

/** Floor staff see their own swaps here; the oversight queue is /admin/shift-swaps (COL-661). */
export default function CaregiverShiftSwapsPage() {
  return <MyShiftSwaps />;
}
