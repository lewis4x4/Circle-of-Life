import { DEFAULT_MONDAY_TIMES, wallClockMinutes, type MondayTimes } from '@/lib/stand-up/model';

/** COL-427: entry is always available; opening leads are no longer editable. */
export function EntryWindowSettings({ times = DEFAULT_MONDAY_TIMES }: {
  times?: MondayTimes;
}) {
  return <section aria-label="Entry window" className="space-y-3 border-t border-border pt-4">
    <h3 className="font-medium">Entry window</h3>
    <p className="text-sm text-muted-foreground">Entry is available anytime for all ALFs. Each Monday and Thursday record locks at its scheduled meeting call, and the next report opens immediately.</p>
    <p className="text-sm text-muted-foreground">Monday target: {wallClockMinutes(times.dueMinutes)} Eastern. Monday record locks: {wallClockMinutes(times.callMinutes)} Eastern. Meeting times are set on the meeting schedule.</p>
  </section>;
}
