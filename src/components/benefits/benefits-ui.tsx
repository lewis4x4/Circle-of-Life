"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormLabel } from "@/components/ui/form-label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  facilityDatetimeLocalToUtcIso,
  formatFacilityTimestampEt,
  utcIsoToFacilityDatetimeLocal,
} from "@/lib/facility-wall-clock";

export type Choice = { value: string; label: string };
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "select"
    | "date"
    | "datetime-local"
    | "money"
    | "number";
  options?: Choice[];
  required?: boolean;
  help?: string;
  value?: unknown;
};
export const fieldClass =
  "min-h-11 w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2 text-sm focus-visible:outline-ring";
export function label(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
}
export function dateLabel(value: string | null | undefined) {
  return !value
    ? "Not recorded"
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : `${formatFacilityTimestampEt(value)} ET`;
}
export class BenefitsRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function benefitsFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new BenefitsRequestError(
      response.status === 409
        ? "This case changed while you were working. Refresh the case, review the current information, then save again. Your draft is preserved."
        : response.status === 403
          ? "Benefits access is restricted. Ask an owner or organization administrator to review your facility access."
          : response.status === 401
            ? "Your session needs to be renewed. Sign in again before continuing."
            : (body?.error ??
              "Benefits information could not be verified. Please try again."),
      response.status,
    );
  return body as T;
}
export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
export function ErrorNotice({ error }: { error: string | null }) {
  return error ? (
    <p
      role="alert"
      className="rounded-[var(--radius)] border border-destructive/40 p-3 text-sm text-destructive"
    >
      {error}
    </p>
  ) : null;
}
export function FormField({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div
      className={
        field.type === "textarea" ? "space-y-2 sm:col-span-2" : "space-y-2"
      }
    >
      <FormLabel htmlFor={id} required={field.required}>
        {field.label}
      </FormLabel>
      {field.type === "select" ? (
        <select
          id={id}
          name={field.name}
          className={fieldClass}
          required={field.required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <Textarea
          id={id}
          name={field.name}
          required={field.required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          name={field.name}
          className="min-h-11"
          type={field.type === "money" ? "number" : (field.type ?? "text")}
          min={
            field.type === "money" || field.type === "number" ? 0 : undefined
          }
          step={field.type === "money" ? "0.01" : undefined}
          required={field.required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.help && (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      )}
    </div>
  );
}
function initialValue(field: Field): string {
  if (field.value == null) return "";
  if (field.type === "money") return String(Number(field.value) / 100);
  if (field.type === "datetime-local" && field.value)
    return utcIsoToFacilityDatetimeLocal(String(field.value));
  return String(field.value);
}
export function ActionForm({
  title,
  fields,
  submitLabel = "Save",
  onSubmit,
  disabled,
  description,
}: {
  title: string;
  fields: Field[];
  submitLabel?: string;
  onSubmit: (
    payload: Record<string, unknown>,
    requestId: string,
  ) => Promise<void>;
  disabled?: boolean;
  description?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.name, initialValue(field)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = useRef(new Set<string>());
  const sourceValues = JSON.stringify(
    Object.fromEntries(
      fields.map((field) => [field.name, initialValue(field)]),
    ),
  );
  useEffect(() => {
    const incoming = JSON.parse(sourceValues) as Record<string, string>;
    setValues((current) =>
      Object.fromEntries(
        Object.entries(incoming).map(([name, value]) => [
          name,
          dirty.current.has(name) ? (current[name] ?? value) : value,
        ]),
      ),
    );
  }, [sourceValues]);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  return (
    <Panel title={title} description={description}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || disabled) return;
          setBusy(true);
          setError(null);
          setSaved(false);
          try {
            const payload = Object.fromEntries(
              fields.map((field) => {
                const value = values[field.name] ?? "";
                return [
                  field.name,
                  value === ""
                    ? null
                    : field.type === "money"
                      ? Math.round(Number(value) * 100)
                      : field.type === "number"
                        ? Number(value)
                        : field.type === "datetime-local"
                          ? facilityDatetimeLocalToUtcIso(value)
                          : value,
                ];
              }),
            );
            const fingerprint = JSON.stringify(payload);
            if (request.current?.fingerprint !== fingerprint)
              request.current = { fingerprint, id: crypto.randomUUID() };
            await onSubmit(payload, request.current.id);
            request.current = null;
            dirty.current.clear();
            setSaved(true);
          } catch (caught) {
            if (caught instanceof BenefitsRequestError && caught.status === 409)
              request.current = null;
            setError(
              caught instanceof Error
                ? caught.message
                : "Unable to save. Your draft is preserved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset
          disabled={busy || disabled}
          className="grid gap-4 sm:grid-cols-2"
        >
          {fields.map((field) => (
            <FormField
              key={field.name}
              field={field}
              value={values[field.name] ?? ""}
              onChange={(value) => {
                dirty.current.add(field.name);
                setSaved(false);
                setValues((current) => ({ ...current, [field.name]: value }));
              }}
            />
          ))}
        </fieldset>
        <ErrorNotice error={error} />
        {saved && (
          <p role="status" className="text-sm">
            Saved successfully.
          </p>
        )}
        <Button type="submit" className="min-h-11" disabled={busy || disabled}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Panel>
  );
}
