"use client";

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { QuietDatePicker } from "@/components/ui/quiet-date-picker";
import type { InputRule } from "@/lib/operations/workspace";

export const CONTROL =
  "min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export type Values = Record<string, string | number | boolean | null>;

/** Date and time stay empty until selected; the displayed zone is explicit. */
export function DateTimeInput({
  id,
  label,
  value,
  onChange,
  required = false,
  timezone,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  timezone: string;
}) {
  const [date = "", time = ""] = value.split("T");
  return (
    <fieldset className="space-y-2">
      <legend>
        {label}
        {required ? " (required)" : ""}
      </legend>
      <label htmlFor={id}>Date</label>
      <QuietDatePicker
        touchTargets
        initialVisibleMonthIso={formatInTimeZone(
          new Date(),
          timezone,
          "yyyy-MM-dd",
        )}
        id={id}
        value={date}
        onValueChange={(next) =>
          onChange(next || time ? `${next}T${time}` : "")
        }
      />
      <label htmlFor={`${id}-time`}>Time ({timezone})</label>
      <input
        id={`${id}-time`}
        type="time"
        step="any"
        className={CONTROL}
        value={time.replace(/Z$/, "")}
        required={required || Boolean(date)}
        onChange={(event) =>
          onChange(
            date || event.target.value ? `${date}T${event.target.value}` : "",
          )
        }
      />
    </fieldset>
  );
}

export function WorkInputs({
  rules,
  values,
  onChange,
  prefix,
  timezone,
}: {
  rules: InputRule[];
  values: Values;
  onChange: (values: Values) => void;
  prefix: string;
  timezone: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rules.map((rule) => {
        const id = `${prefix}-${rule.key}`;
        const update = (value: Values[string]) =>
          onChange({ ...values, [rule.key]: value });
        const label = `${rule.label}${rule.unit ? ` (${rule.unit})` : ""}`;
        if (rule.type === "datetime")
          return (
            <DateTimeInput
              timezone={timezone}
              key={rule.key}
              id={id}
              label={label}
              value={String(values[rule.key] ?? "")}
              required={rule.required}
              onChange={update}
            />
          );
        return (
          <div key={rule.key} className="flex flex-col gap-1">
            <label htmlFor={id}>
              {label}
              {rule.required ? " (required)" : ""}
            </label>
            {rule.type === "boolean" || rule.type === "choice" ? (
              <select
                id={id}
                className={CONTROL}
                required={rule.required}
                value={String(values[rule.key] ?? "")}
                onChange={(event) =>
                  update(
                    rule.type === "boolean" && event.target.value !== ""
                      ? event.target.value === "true"
                      : event.target.value,
                  )
                }
              >
                <option value="">Choose…</option>
                {(rule.type === "boolean"
                  ? ["true", "false"]
                  : (rule.choices ?? [])
                ).map((choice) => (
                  <option key={choice} value={choice}>
                    {rule.type === "boolean"
                      ? choice === "true"
                        ? "Yes"
                        : "No"
                      : choice}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                className={CONTROL}
                required={rule.required}
                type={rule.type === "number" ? "number" : "text"}
                step={rule.type === "number" ? "any" : undefined}
                min={rule.min}
                max={rule.max}
                value={String(values[rule.key] ?? "")}
                onChange={(event) =>
                  update(
                    rule.type === "number" && event.target.value !== ""
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function typedValues(
  rules: InputRule[],
  values: Values,
  timezone: string,
  original: Values = {},
): Values {
  const result: Values = {};
  for (const rule of rules) {
    const value = values[rule.key];
    if (value === undefined || value === "" || value === null) {
      if (rule.required) throw new Error(`${rule.label} is required`);
      continue;
    }
    if (rule.type === "datetime") {
      if (
        typeof original[rule.key] === "string" &&
        displayValues([rule], original, timezone)[rule.key] === value
      ) {
        result[rule.key] = original[rule.key];
        continue;
      }
      const raw = String(value).replace(/Z$/, "");
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw) ||
        Number.isNaN(Date.parse(`${raw}Z`))
      )
        throw new Error(`${rule.label} needs a date and time`);
      const instant = fromZonedTime(raw, timezone);
      if (
        Number.isNaN(instant.getTime()) ||
        formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm") !==
          raw.slice(0, 16)
      )
        throw new Error(`${rule.label} is not a valid local date and time`);
      result[rule.key] = instant.toISOString();
    } else result[rule.key] = value;
  }
  return result;
}

export function displayValues(
  rules: InputRule[],
  values: Values,
  timezone: string,
): Values {
  const displayed = { ...values };
  for (const rule of rules)
    if (
      rule.type === "datetime" &&
      typeof values[rule.key] === "string" &&
      !Number.isNaN(Date.parse(String(values[rule.key])))
    )
      displayed[rule.key] = formatInTimeZone(
        String(values[rule.key]),
        timezone,
        "yyyy-MM-dd'T'HH:mm:ss.SSS",
      );
  return displayed;
}
