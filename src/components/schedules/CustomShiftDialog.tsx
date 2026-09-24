"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatScheduleTimes, scheduledHours } from "@/lib/schedules/week-grid";

type Props = {
  personName: string;
  date: string;
  dateLabel: string;
  timeZone: string;
  initialStart: string;
  initialEnd: string;
  onApply: (start: string, end: string) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
};

export default function CustomShiftDialog({ personName, date, dateLabel, timeZone, initialStart, initialEnd, onApply, onClose, onRestoreFocus }: Props) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const hours = scheduledHours(date, start, end, timeZone);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end) && hours !== null;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-md" onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader><DialogTitle>Custom shift</DialogTitle><DialogDescription>{personName} · {dateLabel} · {timeZone}</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label htmlFor="custom-shift-start">Start time</Label><Input id="custom-shift-start" type="time" step="60" value={start} onChange={(event) => setStart(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="custom-shift-end">Finish time</Label><Input id="custom-shift-end" type="time" step="60" value={end} onChange={(event) => setEnd(event.target.value)} /></div>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{valid
        ? `${formatScheduleTimes(start, end)} · ${hours.toFixed(1)} scheduled hours${end < start ? ". Finishes the next day." : "."}`
        : start && end ? "Choose different start and finish times." : "Choose both times. An earlier finish time means the next day."}</p>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!valid} onClick={() => { if (valid) onApply(start, end); }}>Apply times</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
