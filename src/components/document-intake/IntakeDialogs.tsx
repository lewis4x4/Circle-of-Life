"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import type { IntakeItem } from "@/lib/document-intake/contracts";

import { intakeClient, searchOtherItems, type ItemOption, type ReviewerOption } from "./data";
import { itemTitle, statusLabel } from "./model";

export const FIELD_CLASS =
  "min-h-11 w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Submit<T> = (value: T) => Promise<string | null>;

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

function Footer({ busy, confirm, disabled, onCancel, destructive }: { busy: boolean; confirm: string; disabled: boolean; onCancel: () => void; destructive?: boolean }) {
  return (
    <DialogFooter className="gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={disabled || busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {confirm}
      </Button>
    </DialogFooter>
  );
}

/** Hold, exclude and correct: a required reason the history keeps. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirm,
  destructive,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  confirm: string;
  destructive?: boolean;
  onSubmit: Submit<string>;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            setBusy(true);
            setError(await onSubmit(reason.trim()));
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <FormLabel htmlFor={id} required>
              {label}
            </FormLabel>
            <Textarea id={id} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} required />
          </div>
          <ErrorLine error={error} />
          <Footer busy={busy} confirm={confirm} disabled={!reason.trim()} onCancel={() => onOpenChange(false)} destructive={destructive} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => Promise<string | null>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(await onConfirm());
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <ErrorLine error={error} />
          <Footer busy={busy} confirm={confirm} disabled={false} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssignDialog({
  open,
  onOpenChange,
  reviewers,
  currentUserId,
  assignedTo,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewers: ReviewerOption[];
  currentUserId: string | null;
  assignedTo: string | null;
  onSubmit: Submit<string | null>;
}) {
  const id = useId();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setChoice("");
      setError(null);
    }
  }, [open]);
  const options = [
    ...(currentUserId && !reviewers.some((r) => r.id === currentUserId) ? [{ id: currentUserId, name: "Me", coverage: "" }] : []),
    ...reviewers.map((r) => (r.id === currentUserId ? { ...r, name: `${r.name} (me)` } : r)),
  ];
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!choice) return;
            setBusy(true);
            setError(await onSubmit(choice === "unassigned" ? null : choice));
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Assign this document</DialogTitle>
            <DialogDescription>The person you pick sees it under “Assigned to me”.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <FormLabel htmlFor={id} required>
              Reviewer
            </FormLabel>
            <select id={id} className={FIELD_CLASS} value={choice} onChange={(e) => setChoice(e.target.value)} required>
              <option value="" disabled>
                Choose a reviewer
              </option>
              {options.map((r) => (
                <option key={r.id} value={r.id} disabled={r.id === assignedTo}>
                  {r.name}
                  {r.coverage === "backup" ? " — backup" : r.coverage === "custodian" ? " — custodian" : ""}
                </option>
              ))}
              {assignedTo ? <option value="unassigned">Nobody (unassign)</option> : null}
            </select>
          </div>
          <ErrorLine error={error} />
          <Footer busy={busy} confirm="Assign" disabled={!choice} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateDialog({
  open,
  onOpenChange,
  item,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Pick<IntakeItem, "id" | "facility_id">;
  onSubmit: Submit<string>;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ItemOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setChoice("");
      setError(null);
      setOptions(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchOtherItems(intakeClient(), item, query)
        .then((rows) => {
          if (live) {
            setOptions(rows);
            setLoadError(null);
          }
        })
        .catch((cause) => live && setLoadError(cause instanceof Error ? cause.message : "Documents could not be loaded."));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, query, item]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!choice) return;
            setBusy(true);
            setError(await onSubmit(choice));
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Mark as a duplicate</DialogTitle>
            <DialogDescription>Pick the document this one repeats. This one leaves the queue; the other is not changed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <FormLabel htmlFor={searchId}>Search this facility’s documents</FormLabel>
            <Input id={searchId} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          </div>
          <fieldset className="grid max-h-72 gap-1 overflow-y-auto">
            <legend className="sr-only">Documents</legend>
            {loadError ? <ErrorLine error={loadError} /> : null}
            {options == null && !loadError ? <p className="text-sm text-muted-foreground">Loading documents…</p> : null}
            {options?.length === 0 ? <p className="text-sm text-muted-foreground">No other documents match.</p> : null}
            {options?.map((o) => (
              <label key={o.id} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                <input type="radio" name="duplicate-of" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{itemTitle(o)}</span>
                  <span className="block text-xs text-muted-foreground">
                    Received {formatFacilityTimestampEt(o.received_at)} ET · {statusLabel(o.status)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <ErrorLine error={error} />
          <Footer busy={busy} confirm="Mark duplicate" disabled={!choice} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SetFacilityDialog({
  open,
  onOpenChange,
  facilities,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilities: Array<{ id: string; name: string }>;
  onSubmit: Submit<string>;
}) {
  const id = useId();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setChoice("");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!choice) return;
            setBusy(true);
            setError(await onSubmit(choice));
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Set the facility</DialogTitle>
            <DialogDescription>The document moves to that facility’s reviewers and is read again with that facility’s people.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <FormLabel htmlFor={id} required>
              Facility
            </FormLabel>
            <select id={id} className={FIELD_CLASS} value={choice} onChange={(e) => setChoice(e.target.value)} required>
              <option value="" disabled>
                No facility chosen
              </option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <ErrorLine error={error} />
          <Footer busy={busy} confirm="Set facility" disabled={!choice} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
