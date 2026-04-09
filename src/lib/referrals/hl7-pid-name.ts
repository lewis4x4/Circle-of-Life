/**
 * Best-effort HL7 PID-5 patient name (family^given^...) for inbound referral UX.
 * Returns null if PID or PID-5 is missing; callers should use placeholders.
 */
export function tryParsePid5Name(rawMessage: string): { first_name: string; last_name: string } | null {
  const raw = rawMessage?.trim();
  if (!raw) return null;

  const normalized = raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  const pidLine = normalized
    .split("\r")
    .map((s) => s.trim())
    .find((s) => s.startsWith("PID"));
  if (!pidLine || pidLine.length < 8) return null;

  const sep = pidLine[3];
  if (!sep || sep === "\r" || sep === "\n") return null;

  const fields = pidLine.slice(4).split(sep);
  const pid5 = fields[4]?.trim();
  if (!pid5) return null;

  const parts = pid5.split("^");
  const family = parts[0]?.trim();
  const given = parts[1]?.trim();
  if (!family && !given) return null;

  return {
    last_name: family || "Referral",
    first_name: given || "HL7",
  };
}
