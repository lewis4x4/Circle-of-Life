"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import type {
  BenefitsAccessGrant,
  BenefitsOptions,
} from "@/lib/benefits/contracts";
import {
  ActionForm,
  benefitsFetch,
  dateLabel,
  ErrorNotice,
  Panel,
} from "./benefits-ui";

type AccessResponse = {
  grants: BenefitsAccessGrant[];
  users: Array<{ id: string; name: string; facility_id?: string }>;
  can_manage: boolean;
};
export function BenefitsAccess() {
  const selectedFacilityId = useFacilityStore(
    (state) => state.selectedFacilityId,
  );
  const [data, setData] = useState<AccessResponse | null>(null);
  const [options, setOptions] = useState<BenefitsOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const suffix = selectedFacilityId
          ? `?facility_id=${selectedFacilityId}`
          : "";
        const [access, choices] = await Promise.all([
          benefitsFetch<AccessResponse>(`/api/admin/benefits/access${suffix}`, {
            signal,
          }),
          benefitsFetch<BenefitsOptions>(
            `/api/admin/benefits/options${suffix}`,
            { signal },
          ),
        ]);
        if (!signal?.aborted) {
          setData(access);
          setOptions(choices);
        }
      } catch (caught) {
        if (!signal?.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to verify access grants.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [selectedFacilityId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const save = async (payload: Record<string, unknown>) => {
    await benefitsFetch("/api/admin/benefits/access", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await load();
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-24 pt-6">
      <Link
        className="inline-flex min-h-11 items-center underline"
        href="/admin/benefits"
      >
        Back to benefits
      </Link>
      <h1 className="text-2xl font-semibold">Benefits access</h1>
      <p className="text-sm text-muted-foreground">
        Owners and organization administrators grant current facility staff
        access to private financial case work. Grants expire and may be revoked.
      </p>
      <ErrorNotice error={error} />
      {loading && <p role="status">Verifying benefits access…</p>}
      {error && (
        <Button className="min-h-11" onClick={() => void load()}>
          Try again
        </Button>
      )}
      {data && !data.can_manage && (
        <p>
          Only owners and organization administrators can manage these grants.
        </p>
      )}
      {data?.can_manage && options && (
        <>
          {!selectedFacilityId ? (
            <Panel title="Choose a facility">
              <p>
                Select the facility in Haven’s facility switcher to grant or
                revoke access for its current staff.
              </p>
            </Panel>
          ) : (
            <ActionForm
              key={selectedFacilityId}
              title="Grant or update access"
              description="Read access is included. Review permits evidence acceptance and funding review; write permits case updates. Set both when the reviewer also manages cases."
              submitLabel="Save access grant"
              fields={[
                {
                  name: "user_id",
                  label: "Current facility staff member",
                  required: true,
                  type: "select",
                  options: data.users
                    .filter(
                      (person) =>
                        !person.facility_id ||
                        person.facility_id === selectedFacilityId,
                    )
                    .map((person) => ({
                      value: person.id,
                      label: person.name,
                    })),
                },
                {
                  name: "can_write",
                  label: "May update cases",
                  type: "select",
                  value: "false",
                  required: true,
                  options: [
                    { value: "false", label: "No — read only" },
                    { value: "true", label: "Yes" },
                  ],
                },
                {
                  name: "can_review",
                  label: "May review evidence and funding",
                  type: "select",
                  value: "false",
                  required: true,
                  options: [
                    { value: "false", label: "No" },
                    { value: "true", label: "Yes" },
                  ],
                },
                {
                  name: "expires_at",
                  label: "Access expires (Eastern)",
                  type: "datetime-local",
                  required: true,
                },
                {
                  name: "reason",
                  label: "Reason for access",
                  type: "textarea",
                  required: true,
                },
              ]}
              onSubmit={(payload) =>
                save({
                  ...payload,
                  can_write: payload.can_write === "true",
                  can_review: payload.can_review === "true",
                  facility_id: selectedFacilityId,
                  revoked: false,
                })
              }
            />
          )}
          <Panel title="Recorded grants">
            {!data.grants.length && (
              <p className="text-sm text-muted-foreground">
                No explicit grants recorded for this view.
              </p>
            )}
            <ul className="space-y-4">
              {data.grants.map((grant) => (
                <li
                  key={grant.id}
                  className="space-y-2 border-b border-border pb-4"
                >
                  <p className="font-medium">
                    {grant.user_name} · {grant.facility_name}
                  </p>
                  <p className="text-sm">
                    Read{grant.can_write ? ", write" : ""}
                    {grant.can_review ? ", review" : ""} · Expires{" "}
                    {dateLabel(grant.expires_at)} ·{" "}
                    {grant.revoked_at
                      ? "Revoked"
                      : new Date(grant.expires_at).getTime() <= Date.now()
                        ? "Expired"
                        : "Active"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {grant.reason}
                  </p>
                  {!grant.revoked_at && (
                    <details>
                      <summary className="min-h-11 cursor-pointer text-sm underline">
                        Revoke access
                      </summary>
                      <ActionForm
                        title={`Revoke ${grant.user_name}’s benefits access`}
                        fields={[
                          {
                            name: "reason",
                            label: "Reason for revocation",
                            type: "textarea",
                            required: true,
                          },
                        ]}
                        submitLabel="Revoke benefits access"
                        onSubmit={(payload) =>
                          save({
                            ...payload,
                            facility_id: grant.facility_id,
                            user_id: grant.user_id,
                            can_write: grant.can_write,
                            can_review: grant.can_review,
                            expires_at: grant.expires_at,
                            revoked: true,
                          })
                        }
                      />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
