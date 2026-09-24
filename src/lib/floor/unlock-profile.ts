/**
 * Who unlocked this floor tablet (COL-691, spec 40 §6). The top bar, the idle
 * timer and the charted-by lines read it; the lock clears it.
 *
 * Same storage rule as `session-context.ts`: page memory with a sessionStorage
 * mirror so a reload inside one unlock keeps the top bar, never localStorage.
 * It holds a display name and times, nothing that opens anything.
 */

const STORAGE_KEY = "haven-floor-unlock-profile";

export type FloorUnlockProfile = {
  unlockId: string;
  userId: string;
  displayName: string;
  initials: string;
  roleLabel: string;
  clockedInAt: string | null;
  onClock: boolean;
  idleLockMinutes: number;
  unlockedAt: string;
};

let current: FloorUnlockProfile | null = null;

function sessionStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function isProfile(value: unknown): value is FloorUnlockProfile {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.unlockId === "string" &&
    typeof row.userId === "string" &&
    typeof row.displayName === "string" &&
    typeof row.idleLockMinutes === "number"
  );
}

/** "Ashley W." -> "AW". */
export function initialsFromDisplayName(displayName: string): string {
  const letters = displayName
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, "").charAt(0))
    .filter(Boolean);
  return letters.slice(0, 2).join("").toUpperCase() || "?";
}

export function setFloorUnlockProfile(profile: FloorUnlockProfile): void {
  current = profile;
  sessionStore()?.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function currentFloorUnlockProfile(): FloorUnlockProfile | null {
  if (current) return current;
  const raw = sessionStore()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    current = isProfile(parsed) ? parsed : null;
  } catch {
    current = null;
  }
  return current;
}

export function clearFloorUnlockProfile(): void {
  current = null;
  sessionStore()?.removeItem(STORAGE_KEY);
}
