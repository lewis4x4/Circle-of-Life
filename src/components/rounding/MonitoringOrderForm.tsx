"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ORDERED_BY_TYPES,
  ORDER_RECEIVED_AS,
  REASON_CATEGORIES,
  intervalLabel,
  orderedByLabel,
  reasonLabel,
  receivedAsLabel,
  type IntervalOptions,
  type MonitoringOrderDraft,
  type OrderReceivedAs,
  type OrderedByType,
  type ReasonCategory,
} from "@/lib/rounding/monitoring-orders";
import { cn } from "@/lib/utils";

function Field({
  id,
  label,
  required,
  helper,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  helper?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <FormLabel htmlFor={id} required={required}>
        {label}
      </FormLabel>
      {children}
      {helper ? <p className="text-sm text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

/**
 * The Monitoring Order fields, spec 25A section 4.2.
 *
 * Every picker starts empty. The one exception is the start time, which the
 * caller pre-fills with now: a Monitoring Order is a time sensitive clinical
 * event and a blank start on a 21:00 discharge is the worse answer.
 *
 * The interval presets and the custom bounds arrive as rows from
 * public.monitoring_order_interval_options; nothing here is a literal.
 */
export function MonitoringOrderForm({
  draft,
  onChange,
  options,
  disabled,
}: {
  draft: MonitoringOrderDraft;
  onChange: (next: MonitoringOrderDraft) => void;
  options: IntervalOptions;
  disabled?: boolean;
}) {
  const custom =
    draft.intervalMinutes != null && !options.presetMinutes.includes(draft.intervalMinutes);

  function set<K extends keyof MonitoringOrderDraft>(key: K, value: MonitoringOrderDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <div className="space-y-5 text-sm">
      <Field
        id="monitoring-order-interval"
        label="How often"
        required
        helper="Grace scales with the interval, so a shorter order does not carry a long grace."
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="How often">
          {options.presetMinutes.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant={draft.intervalMinutes === preset ? "default" : "outline"}
              size="sm"
              disabled={disabled}
              onClick={() => set("intervalMinutes", preset)}
              className="min-h-[44px]"
            >
              {intervalLabel(preset)}
            </Button>
          ))}
          <Button
            type="button"
            variant={custom ? "default" : "outline"}
            size="sm"
            disabled={disabled}
            onClick={() => set("intervalMinutes", custom ? draft.intervalMinutes : options.minMinutes)}
            className="min-h-[44px]"
          >
            Custom
          </Button>
        </div>
        {custom ? (
          <div className="flex items-center gap-2 pt-2">
            <NumberInput
              value={draft.intervalMinutes ?? options.minMinutes}
              onValueChange={(next) => set("intervalMinutes", next)}
              min={options.minMinutes}
              max={options.maxMinutes}
              disabled={disabled}
              aria-label="Custom interval in minutes"
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">
              minutes, between {options.minMinutes} and {options.maxMinutes}
            </span>
          </div>
        ) : null}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="monitoring-order-ordered-by-type" label="Who ordered it" required>
          <Select
            value={draft.orderedByType}
            onValueChange={(value) => set("orderedByType", value as OrderedByType)}
            disabled={disabled}
          >
            <SelectTrigger id="monitoring-order-ordered-by-type" className="min-h-[44px]">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {ORDERED_BY_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {orderedByLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id="monitoring-order-ordered-by-name"
          label="Their name or facility"
          required
          helper="Who carries the authority for this instruction."
        >
          <Input
            id="monitoring-order-ordered-by-name"
            value={draft.orderedByName}
            disabled={disabled}
            onChange={(event) => set("orderedByName", event.target.value)}
            className="min-h-[44px]"
          />
        </Field>

        <Field id="monitoring-order-received-as" label="How it arrived" required>
          <Select
            value={draft.orderReceivedAs}
            onValueChange={(value) => set("orderReceivedAs", value as OrderReceivedAs)}
            disabled={disabled}
          >
            <SelectTrigger id="monitoring-order-received-as" className="min-h-[44px]">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {ORDER_RECEIVED_AS.map((value) => (
                <SelectItem key={value} value={value}>
                  {receivedAsLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="monitoring-order-reason" label="Reason" required>
          <Select
            value={draft.reasonCategory}
            onValueChange={(value) => set("reasonCategory", value as ReasonCategory)}
            disabled={disabled}
          >
            <SelectTrigger id="monitoring-order-reason" className="min-h-[44px]">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {REASON_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {reasonLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field id="monitoring-order-note" label="One line about why" required>
        <Textarea
          id="monitoring-order-note"
          value={draft.reasonNote}
          disabled={disabled}
          onChange={(event) => set("reasonNote", event.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="monitoring-order-starts-at"
          label="Starts, Eastern (ET)"
          required
          helper="Set to now because the instruction is already in force. Change it if it is not."
        >
          <DateTimePicker
            id="monitoring-order-starts-at"
            value={draft.startsAt}
            onValueChange={(value) => set("startsAt", value)}
            disabled={disabled}
            required
          />
        </Field>

        <Field
          id="monitoring-order-ends-at"
          label="Ends, Eastern (ET)"
          helper="Leave empty for an open ended order."
        >
          <DateTimePicker
            id="monitoring-order-ends-at"
            value={draft.endsAt}
            onValueChange={(value) => set("endsAt", value)}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className={cn(draft.endsAt.trim().length > 0 && "opacity-60")}>
        <Field
          id="monitoring-order-review-due"
          label="Review by, Eastern (ET)"
          required={draft.endsAt.trim().length === 0}
          helper="An order with no end date needs a date somebody comes back to it."
        >
          <DateTimePicker
            id="monitoring-order-review-due"
            value={draft.reviewDueAt}
            onValueChange={(value) => set("reviewDueAt", value)}
            disabled={disabled || draft.endsAt.trim().length > 0}
          />
        </Field>
      </div>
    </div>
  );
}

export default MonitoringOrderForm;
