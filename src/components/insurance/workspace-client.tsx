"use client";

import Link from "next/link";
import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DOCUMENT_FAMILIES,
  type InsuranceWorkspace,
} from "@/lib/insurance/workspace-types";
import { InsuranceHubNav } from "@/app/(admin)/insurance/insurance-hub-nav";

export const controlClass =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export const panelClass =
  "space-y-4 rounded-xl border border-border bg-card p-5";
export const readable = (value: string) => value.replaceAll("_", " ");
export const moneyLabel = (value: number | null | undefined) =>
  value == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value / 100);

export async function insuranceRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.error ||
        `Insurance request failed (${response.status}). Please retry.`,
    );
  return payload as T;
}
export function insuranceCommand<T>(
  action: string,
  payload: unknown,
): Promise<T> {
  return insuranceRequest<T>("/api/insurance/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
}

export function useInsuranceWorkspace() {
  const {
    loading: authLoading,
    organizationId,
    appRole,
    user,
  } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const key = `${organizationId}:${user?.id}:${appRole}:${selectedFacilityId}`;
  const [state, setState] = useState<{
    key: string;
    data?: InsuranceWorkspace;
    error?: string;
  }>({ key: "" });
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((v) => v + 1), []);
  useEffect(() => {
    if (authLoading || !organizationId) return;
    const controller = new AbortController();
    const query = selectedFacilityId
      ? `?facility_id=${encodeURIComponent(selectedFacilityId)}`
      : "";
    insuranceRequest<InsuranceWorkspace>(`/api/insurance/workspace${query}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load insurance workspace.",
          });
      });
    return () => controller.abort();
  }, [authLoading, organizationId, key, selectedFacilityId, reload]);
  const current =
    state.key === key && !authLoading && organizationId ? state : null;
  return {
    data: current?.data,
    error: current?.error,
    authLoading,
    organizationId,
    appRole,
    selectedFacilityId,
    refresh,
  };
}
export type WorkspaceState = ReturnType<typeof useInsuranceWorkspace>;

export function WorkspacePage({
  title,
  state,
  children,
}: {
  title: string;
  state: WorkspaceState;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6 pb-12">
      <InsuranceHubNav />
      <header>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {state.data?.can_manage
            ? "Review source evidence, confirm the record, and track the next action."
            : "Insurance information for your authorized facilities."}
        </p>
      </header>
      {state.authLoading ? (
        <>
          <p role="status">Loading insurance profile…</p>
          <p>Role context will appear when the operator profile is ready.</p>
        </>
      ) : !state.organizationId ? (
        <p>No organization on this profile</p>
      ) : state.error ? (
        <div className={panelClass}>
          <p role="alert">{state.error}</p>
          <Button onClick={state.refresh}>Retry loading insurance</Button>
        </div>
      ) : !state.data ? (
        <p role="status">Loading insurance workspace…</p>
      ) : (
        children
      )}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5 text-sm">
      <label className="block font-medium" htmlFor={id}>
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id: string;
              "aria-describedby"?: string;
            }>,
            { id, "aria-describedby": hint ? hintId : undefined },
          )
        : children}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function UploadInsuranceDocument({
  workspace,
  onUploaded,
}: {
  workspace: InsuranceWorkspace;
  onUploaded: (id: string) => void;
}) {
  const [family, setFamily] = useState<string>("policy");
  const [facility, setFacility] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <form
      id="upload"
      className={panelClass}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!file || busy) return;
        if (file.size > 4 * 1024 * 1024) {
          setError("Choose a PDF or text file no larger than 4 MiB.");
          return;
        }
        setBusy(true);
        setError("");
        const body = new FormData();
        body.append("file", file);
        body.append("family", family);
        if (facility) body.append("facility_id", facility);
        try {
          const result = await insuranceRequest<{ document: { id: string } }>(
            "/api/insurance/documents",
            { method: "POST", body },
          );
          setFile(null);
          if (fileInput.current) fileInput.current.value = "";
          onUploaded(result.document.id);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Upload failed. Your file is ready to retry.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">Upload insurance document</h2>
      <p className="text-sm text-muted-foreground">
        PDF or plain text, up to 4 MiB. Split larger packets into smaller
        sections. Uploading creates evidence to review; it does not verify
        coverage or issue a certificate.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Document family">
          <select
            className={controlClass}
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            disabled={busy}
          >
            {DOCUMENT_FAMILIES.map((value) => (
              <option key={value} value={value}>
                {readable(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Document facility"
          hint="Leave group documents at organization scope. Matching a location still requires review."
        >
          <select
            className={controlClass}
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            disabled={busy}
          >
            <option value="">Organization document</option>
            {workspace.facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Insurance file">
        <Input
          ref={fileInput}
          type="file"
          accept="application/pdf,text/plain,.pdf,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          required
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={!file || busy}>
        {busy
          ? "Uploading document…"
          : error
            ? "Retry upload"
            : "Upload for review"}
      </Button>
    </form>
  );
}

export function SourceDocument({ id, page }: { id: string; page?: number }) {
  const href = `/api/insurance/documents/${encodeURIComponent(id)}`;
  return (
    <div className="space-y-3">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-primary underline"
      >
        Open original document in a new tab
      </a>
      <iframe
        key={`${id}:${page || 1}`}
        title="Insurance source document"
        src={`${href}#page=${page || 1}`}
        className="min-h-[650px] w-full rounded-lg border border-border"
      />
      <p className="text-xs text-muted-foreground">
        If the preview is unavailable, open the original in a new tab. Check
        each source page before confirming evidence.
      </p>
    </div>
  );
}

export function PoliciesTable({
  workspace,
}: {
  workspace: InsuranceWorkspace;
}) {
  if (!workspace.policies.length)
    return (
      <p className={panelClass}>
        No verified policies yet. Complete document review to establish the
        insurance register.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Insurance policy register</caption>
        <thead className="bg-muted">
          <tr>
            {[
              "Policy",
              "Carrier",
              "Coverage",
              "Term",
              "Verification",
              ...(workspace.can_manage ? ["Premium"] : []),
            ].map((h) => (
              <th className="p-3" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workspace.policies.map((p) => (
            <tr className="border-t border-border" key={p.id}>
              <td className="p-3">
                <Link
                  className="text-primary underline"
                  href={`/admin/insurance/policies/${p.id}`}
                >
                  {p.policy_number || "Policy summary"}
                </Link>
                {workspace.can_manage &&
                  p.verification_status !== "verified" && (
                    <Link
                      className="mt-1 block text-xs text-primary underline"
                      href={`/admin/insurance/policies/new?kind=verification&policy_id=${p.id}`}
                    >
                      Verify existing policy
                    </Link>
                  )}
              </td>
              <td className="p-3">{p.carrier_name || "Unknown"}</td>
              <td className="p-3">{readable(p.policy_type || "Unknown")}</td>
              <td className="p-3">
                {p.effective_date || "Unknown"} –{" "}
                {p.expiration_date || "Unknown"}
              </td>
              <td className="p-3">
                {p.verification_status === "verified"
                  ? "Verified"
                  : "Unverified legacy record"}
              </td>
              {workspace.can_manage && (
                <td className="p-3">
                  {p.verification_status === "verified"
                    ? moneyLabel(p.premium_cents)
                    : "Unverified"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
