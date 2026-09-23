import { FloorShell } from "@/components/floor/FloorShell";

/** Every unlocked floor screen: top bar, tabs, lock triggers and heartbeat (spec 40 §1, §6). */
export default function FloorUnlockedLayout({ children }: { children: React.ReactNode }) {
  return <FloorShell>{children}</FloorShell>;
}
