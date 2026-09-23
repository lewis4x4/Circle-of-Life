"use client";

import { Check, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import {
  KIOSK_KINDS,
  KIOSK_VISITOR_COPY,
  KIOSK_VISITOR_ERROR_COPY,
  KIOSK_VISITOR_SIGN_IN_ENDPOINT,
  validateKioskSignIn,
  type KioskFieldErrors,
  type KioskFieldName,
  type KioskFieldRule,
  type KioskSignInRequest,
  type KioskSignInResponse,
  type KioskVisitorErrorCode,
  type KioskVisitorKind,
} from "@/lib/kiosk/contract";
import { KIOSK_SIGN_IN_COPY, formatKioskClock, kioskRandomId } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

import { ConfirmPanel } from "./ConfirmPanel";
import { KioskField } from "./KioskField";
import { KioskHeader } from "./KioskHeader";
import { YesNoToggle } from "./YesNoToggle";
import { kioskRequestInit, useKiosk } from "./kiosk-context";
import { KIOSK_PRIMARY } from "./kiosk-styles";

type TextField = Exclude<KioskFieldName, "symptoms">;
type Values = Record<TextField, string>;

const EMPTY: Values = { name: "", phone: "", company: "", visiting_name: "", purpose: "" };

function responseCode(body: unknown): KioskVisitorErrorCode {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof code === "string" && code in KIOSK_VISITOR_ERROR_COPY ? (code as KioskVisitorErrorCode) : "unavailable";
}

/**
 * `/kiosk/sign-in/[kind]` (`14`, `14b`, `15`, `16`). One layout for every kind;
 * the fields and which are required come from the contract the route checks.
 * The resident is typed, never looked up. One client entry id per form, so a
 * retried tap signs the visitor in once.
 */
export function KioskSignInForm({ kind }: { kind: KioskVisitorKind }) {
  const router = useRouter();
  const { device, fetchImpl, timeZone, forgetDevice, goHome } = useKiosk();
  const definition = KIOSK_KINDS[kind];
  const [clientEntryId] = useState(kioskRandomId);
  const [values, setValues] = useState<Values>(EMPTY);
  const [symptoms, setSymptoms] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<KioskFieldErrors>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedInAt, setSignedInAt] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const has = (field: KioskFieldName) => definition.fields.some((rule) => rule.name === field);
  const form = () => ({
    name: values.name,
    phone: has("phone") ? values.phone : null,
    company: has("company") ? values.company : null,
    visiting_name: has("visiting_name") ? values.visiting_name : null,
    purpose: has("purpose") ? values.purpose : null,
    symptoms: has("symptoms") ? symptoms : null,
  });

  const showErrors = (found: KioskFieldErrors) => {
    setErrors(found);
    setStatus(KIOSK_SIGN_IN_COPY.fixFields);
    const first = definition.fields.find((rule) => found[rule.name]);
    const selector = first?.name === "symptoms" ? '[aria-labelledby="kiosk-symptoms-label"] button' : `[data-field="${first?.name}"]`;
    if (first) formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!device || busy) return;
    const checked = validateKioskSignIn(kind, form());
    if (!checked.ok) return showErrors(checked.errors);
    setErrors({});
    setStatus("");
    setBusy(true);
    try {
      const request: KioskSignInRequest = { ...form(), kind, client_entry_id: clientEntryId };
      const response = await fetchImpl(KIOSK_VISITOR_SIGN_IN_ENDPOINT, kioskRequestInit(device.token, { method: "POST", json: request }));
      const body = (await response.json().catch(() => null)) as unknown;
      if (response.ok) {
        setSignedInAt((body as KioskSignInResponse).checked_in_at);
        return;
      }
      const code = responseCode(body);
      if (code === "device_unknown") {
        await forgetDevice();
        router.replace("/kiosk/setup");
        return;
      }
      const fields = (body as { fields?: KioskFieldErrors } | null)?.fields;
      if (code === "invalid_input" && fields && Object.keys(fields).length > 0) return showErrors(fields);
      setStatus(KIOSK_VISITOR_ERROR_COPY[code]);
    } catch {
      setStatus(KIOSK_VISITOR_ERROR_COPY.unavailable);
    } finally {
      setBusy(false);
    }
  }

  if (signedInAt) {
    return (
      <main className="flex min-h-dvh flex-col bg-background">
        <KioskHeader title={KIOSK_SIGN_IN_COPY.signedInHeader} />
        <ConfirmPanel
          title={KIOSK_SIGN_IN_COPY.signedInTitle}
          body={`Signed in at ${formatKioskClock(signedInAt, timeZone)}.`}
          warning={symptoms === true ? KIOSK_VISITOR_COPY.sickWarning : undefined}
          card={{
            icon: LogOut,
            content: (
              <>
                {KIOSK_VISITOR_COPY.signOutReminder.before}
                <b className="font-semibold">{KIOSK_VISITOR_COPY.signOutReminder.strong}</b>
                {KIOSK_VISITOR_COPY.signOutReminder.after}
              </>
            ),
          }}
          onDone={goHome}
        />
      </main>
    );
  }

  const field = (rule: KioskFieldRule) => {
    const id = `kiosk-${rule.name}`;
    if (rule.name === "symptoms") {
      const errorId = errors.symptoms ? `${id}-error` : undefined;
      return (
        <div key={rule.name} className="flex flex-col gap-2.5">
          <p id={`${id}-label`} className="text-[17px] font-semibold text-foreground">
            {rule.label}
          </p>
          <YesNoToggle
            labelId={`${id}-label`}
            value={symptoms}
            onChange={(answer) => {
              setSymptoms(answer);
              setErrors((current) => ({ ...current, symptoms: undefined }));
            }}
            describedBy={errorId}
          />
          <div role="status" className="flex flex-col gap-1">
            {symptoms === true ? <p className="text-base font-semibold text-destructive">{KIOSK_VISITOR_COPY.sickWarning}</p> : null}
            {errors.symptoms ? (
              <p id={errorId} className="text-sm font-semibold text-destructive">
                {errors.symptoms}
              </p>
            ) : null}
          </div>
        </div>
      );
    }
    const name = rule.name as TextField;
    return (
      <KioskField
        key={name}
        id={id}
        data-field={name}
        label={rule.label}
        required={rule.required}
        markRequired={rule.markRequired}
        placeholder={rule.placeholder}
        hint={rule.hint}
        error={errors[name]}
        value={values[name]}
        type={name === "phone" ? "tel" : "text"}
        inputMode={name === "phone" ? "tel" : "text"}
        autoCapitalize={name === "phone" ? "off" : "words"}
        onChange={(event) => {
          const next = event.target.value;
          setValues((current) => ({ ...current, [name]: next }));
          if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
        }}
      />
    );
  };

  const split = Math.ceil(definition.fields.length / 2);
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <KioskHeader title={definition.title} back />
      <form ref={formRef} onSubmit={submit} noValidate aria-label={definition.title} className="flex flex-1 flex-col gap-5.5 px-10 pb-6 pt-6.5">
        <p className="text-[19px] text-muted-foreground">{definition.formSubtitle}</p>
        <div className="flex flex-1 gap-9">
          <div className="flex min-w-0 flex-1 basis-0 flex-col gap-5.5">{definition.fields.slice(0, split).map(field)}</div>
          <div className="flex min-w-0 flex-1 basis-0 flex-col gap-5.5">{definition.fields.slice(split).map(field)}</div>
        </div>
        <p role="status" className="text-base font-semibold text-destructive empty:hidden">
          {status}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-[15px] text-muted-foreground">{KIOSK_VISITOR_COPY.visitorLogLine}</p>
          <button type="submit" className={cn(KIOSK_PRIMARY, "h-18 w-75 max-w-full")} disabled={busy}>
            <Check className="size-5.5" aria-hidden />
            {KIOSK_SIGN_IN_COPY.submit}
          </button>
        </div>
      </form>
    </main>
  );
}
