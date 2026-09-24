"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatScheduleTimes, scheduledHours } from "@/lib/schedules/week-grid";
import { validatePresetBlocks, type PresetBlock } from "@/lib/schedules/presets";

type Props = {
  personName: string;
  date: string;
  dateLabel: string;
  timeZone: string;
  initialBlocks: PresetBlock[];
  initialRoundingCoverage: boolean;
  onApply: (blocks: PresetBlock[], roundingCoverage: boolean) => void;
  onSetOff: () => void;
  onClose: () => void;
  onRestoreFocus: () => void;
};

export default function CustomShiftDialog({ personName, date, dateLabel, timeZone, initialBlocks, initialRoundingCoverage, onApply, onSetOff, onClose, onRestoreFocus }: Props) {
  const [blocks, setBlocks] = useState<PresetBlock[]>(initialBlocks.length ? initialBlocks.map((block) => ({ ...block })) : [{ start: "", end: "" }]);
  const [roundingCoverage, setRoundingCoverage] = useState(initialRoundingCoverage);
  const addButton = useRef<HTMLButtonElement>(null);
  const validation = validatePresetBlocks(blocks);
  const elapsed = blocks.map((block) => scheduledHours(date, block.start, block.end, timeZone));
  const valid = validation.valid && elapsed.every((hours) => hours !== null);
  const hours = elapsed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  function change(index: number, field: keyof PresetBlock, value: string) {
    setBlocks((current) => current.map((block, i) => i === index ? { ...block, [field]: value } : block));
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader><DialogTitle>Custom shift</DialogTitle><DialogDescription>{personName} · {dateLabel} · {timeZone}</DialogDescription></DialogHeader>
      <div className="space-y-4">{blocks.map((block, index) => <fieldset key={index} className="rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">{blocks.length > 1 ? `Block ${index + 1}` : "Work time"}</legend>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label htmlFor={`custom-shift-start-${index}`}>{index === 0 ? "Start time" : `Block ${index + 1} start`}</Label><Input id={`custom-shift-start-${index}`} type="time" step="60" value={block.start} onChange={(event) => change(index, "start", event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor={`custom-shift-end-${index}`}>{index === 0 ? "Finish time" : `Block ${index + 1} finish`}</Label><Input id={`custom-shift-end-${index}`} type="time" step="60" value={block.end} onChange={(event) => change(index, "end", event.target.value)} /></div>
        </div>
        {blocks.length > 1 && <Button type="button" variant="ghost" size="sm" className="mt-2" aria-label={`Remove block ${index + 1}`} onClick={() => { setBlocks((current) => current.filter((_, i) => i !== index)); addButton.current?.focus(); }}>Remove block</Button>}
      </fieldset>)}</div>
      <Button ref={addButton} type="button" variant="outline" disabled={blocks.length >= 8} onClick={() => setBlocks((current) => [...current, { start: "", end: "" }])}>Add another block</Button>
      <p className="text-sm text-muted-foreground" aria-live="polite">{valid
        ? `${blocks.map((block) => formatScheduleTimes(block.start, block.end)).join("; ")} · ${hours.toFixed(1)} scheduled hours${blocks.some((block) => block.end < block.start) ? ". Finishes the next day." : "."}${blocks.length > 1 ? " Gaps between blocks are excluded." : ""}`
        : validation.valid ? "A time does not occur on this date in the facility’s time zone. Choose a different time."
          : blocks.some((block) => !block.start || !block.end) ? "Choose both times for each block. An earlier finish means the next day." : validation.errors[0]}
      </p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={roundingCoverage} onChange={(event) => setRoundingCoverage(event.target.checked)} /><span>Use for resident check coverage<span className="mt-1 block text-xs text-muted-foreground">Only staff already authorized for checks can be assigned. This does not grant permissions or change check timing.</span></span></label>
      <DialogFooter><Button type="button" variant="outline" onClick={onSetOff}>Set off</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!valid} onClick={() => { if (valid) onApply(blocks, roundingCoverage); }}>Apply times</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
