"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  InsuranceWorkspace,
  InsuranceDocument,
  WorkItem,
  CertificateRequest,
  InsurancePolicy,
} from "@/lib/insurance/workspace-types";
import { PolicyDraftEditor } from "./policy-draft-editor";
import {
  Field,
  PoliciesTable,
  SourceDocument,
  UploadInsuranceDocument,
  WorkspacePage,
  controlClass,
  insuranceCommand,
  insuranceRequest,
  moneyLabel,
  panelClass,
  readable,
  useInsuranceWorkspace,
} from "./workspace-client";

export function InsuranceOverviewPage() {
  const state = useInsuranceWorkspace();
  const workspace = state.data;
  const verified =
    workspace?.policies.filter((p) => p.verification_status === "verified") ||
    [];
  const knownPremiums = verified.filter(
    (p) => "premium_cents" in p && p.premium_cents != null,
  );
  const premiumTotal = knownPremiums.reduce(
    (total, p) => total + (("premium_cents" in p && p.premium_cents) || 0),
    0,
  );
  return (
    <WorkspacePage title="Insurance & risk" state={state}>
      {workspace && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className={panelClass}>
              <h2 className="font-medium">Verified policy terms</h2>
              <p className="text-3xl font-semibold">
                {verified.length ? verified.length : "Not established"}
              </p>
              <p className="text-sm text-muted-foreground">
                {verified.length
                  ? "Shared terms count once across locations."
                  : "No verified policies yet. Review evidence before relying on the register."}
              </p>
            </div>
            <div className={panelClass}>
              <h2 className="font-medium">Reviews awaiting attention</h2>
              <p className="text-3xl font-semibold">
                {workspace.can_manage
                  ? workspace.drafts.filter((d) => d.status === "draft").length
                  : "Managed by insurance reviewers"}
              </p>
              <Link
                href="/admin/insurance/documents"
                className="text-sm text-primary underline"
              >
                Open document inbox
              </Link>
            </div>
            <div className={panelClass}>
              <h2 className="font-medium">Open work items</h2>
              <p className="text-3xl font-semibold">
                {workspace.work_items.filter((w) => w.status === "open").length}
              </p>
              <Link
                href="/admin/insurance/renewals"
                className="text-sm text-primary underline"
              >
                Review owners and due dates
              </Link>
            </div>
          </div>
          {workspace.can_manage && (
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">
                Premiums and retained costs
              </h2>
              <p>
                Verified stated premiums:{" "}
                <strong>
                  {knownPremiums.length ? moneyLabel(premiumTotal) : "Unknown"}
                </strong>
              </p>
              <p className="text-sm text-muted-foreground">
                {knownPremiums.length} of {verified.length} verified terms have
                a known premium. This is a sum of stated term premiums, not an
                annualized cost or facility allocation. Unverified legacy
                amounts are excluded.
              </p>
              <p className="text-sm">
                Client retained costs: Unknown until finance review.
                Carrier-paid claims and reserves remain separate.
              </p>
            </section>
          )}
          <PoliciesTable workspace={workspace} />
        </>
      )}
    </WorkspacePage>
  );
}

export function InsurancePoliciesPage() {
  const state = useInsuranceWorkspace();
  const [entity, setEntity] = useState("");
  return (
    <WorkspacePage title="Insurance policies" state={state}>
      {state.data && (
        <>
          <Field label="Filter by legal entity">
            <select
              className={`${controlClass} max-w-md`}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
            >
              <option value="">All authorized entities</option>
              {state.data.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <PoliciesTable
            workspace={{
              ...state.data,
              policies: state.data.policies.filter(
                (p) =>
                  !entity ||
                  p.entity_id === entity ||
                  ("parties" in p &&
                    p.parties?.some((link) => link.entity_id === entity)),
              ),
            }}
          />
        </>
      )}
    </WorkspacePage>
  );
}

export function InsuranceDocumentsPage() {
  const state = useInsuranceWorkspace();
  const router = useRouter();
  return (
    <WorkspacePage title="Insurance documents" state={state}>
      {state.data &&
        (state.data.can_manage ? (
          <>
            <UploadInsuranceDocument
              workspace={state.data}
              onUploaded={(id) =>
                router.push(`/admin/insurance/documents/${id}`)
              }
            />
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">Document inbox</h2>
              {!state.data.documents.length ? (
                <p>No insurance documents uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {state.data.documents.map((d) => (
                    <li key={d.id} className="py-3">
                      <Link
                        href={`/admin/insurance/documents/${d.id}`}
                        className="font-medium text-primary underline"
                      >
                        {d.filename}
                      </Link>
                      <p className="text-sm">
                        {readable(d.family)} · File: {readable(d.status)} ·
                        Review: {readable(d.extraction_status)}
                      </p>
                      {d.error && (
                        <p className="text-sm text-destructive">{d.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">Draft reviews</h2>
              {!state.data.drafts.length ? (
                <p>No drafts awaiting review.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {state.data.drafts.map((d) => (
                    <li className="py-3" key={d.id}>
                      <Link
                        className="text-primary underline"
                        href={`/admin/insurance/review/${d.id}`}
                      >
                        {d.payload.policy_number ||
                          d.payload.carrier_name ||
                          "Untitled draft"}
                      </Link>
                      <p className="text-sm">
                        {readable(d.kind)} · {d.status} · Revision {d.revision}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className={panelClass}>
            Original documents and draft reviews are restricted to insurance
            managers. Approved information is available in your facility policy
            summaries.
          </p>
        ))}
    </WorkspacePage>
  );
}

export function InsuranceDocumentPage() {
  const state = useInsuranceWorkspace();
  const params = useParams();
  const id = String(params.id || "");
  const document = state.data?.documents.find((d) => d.id === id);
  return (
    <WorkspacePage title="Insurance document review" state={state}>
      {state.data &&
        (state.data.can_manage && document ? (
          <DocumentDetail
            key={document.id}
            document={document}
            workspace={state.data}
            refresh={state.refresh}
          />
        ) : (
          <p className={panelClass}>
            Document unavailable in your current access scope.
          </p>
        ))}
    </WorkspacePage>
  );
}
function DocumentDetail({
  document,
  workspace,
  refresh,
}: {
  document: InsuranceDocument;
  workspace: InsuranceWorkspace;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const leaseEnd = document.lease_expires_at
    ? Date.parse(document.lease_expires_at)
    : 0;
  const leaseActive =
    document.extraction_status === "processing" && leaseEnd > now;
  useEffect(() => {
    if (!leaseActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [leaseActive]);
  return (
    <>
      <section className={panelClass}>
        <h2 className="text-lg font-semibold">{document.filename}</h2>
        <p>
          File: {readable(document.status)} · Extraction:{" "}
          {readable(document.extraction_status)}
        </p>
        {document.error && <p role="alert">{document.error}</p>}
        {document.status === "quarantined" && (
          <p>
            File is quarantined. Review is unavailable until the file passes the
            configured processing checks.
          </p>
        )}
        {document.scan_status === "not_configured" && (
          <p className="text-sm text-muted-foreground">
            Malware scanning is not configured for this upload. Format checks do
            not certify that a file is malware-free.
          </p>
        )}
        {document.status === "ready" && (
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || leaseActive}
              onClick={async () => {
                setBusy(true);
                setError("");
                setMessage("");
                try {
                  const result = await insuranceRequest<{
                    document: InsuranceDocument;
                  }>(`/api/insurance/documents/${document.id}/extract`, {
                    method: "POST",
                  });
                  setMessage(
                    result.document.extraction_status === "manual_review"
                      ? "Manual review is required. Start a draft and record the supporting evidence."
                      : "Processing saved. Review the resulting draft below.",
                  );
                  refresh();
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Extraction failed. Retry or enter a manual draft.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Processing document…"
                : document.extraction_status === "failed" ||
                    (document.extraction_status === "processing" &&
                      !leaseActive)
                  ? "Retry extraction"
                  : "Extract a review draft"}
            </Button>
            <Link
              className="self-center text-primary underline"
              href={`/admin/insurance/policies/new?document_id=${document.id}`}
            >
              Start manual draft
            </Link>
            <Button variant="outline" onClick={refresh}>
              Refresh processing status
            </Button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {document.extraction_status === "processing" && (
          <p role="status">
            {leaseActive
              ? `Processing is in progress. A new attempt is available in ${Math.ceil((leaseEnd - now) / 1000)} seconds if this attempt does not finish. Refresh status to check for a review draft.`
              : "The processing lease has expired. Retry extraction or start a manual draft; your uploaded source is retained."}
          </p>
        )}
        <ul>
          {workspace.drafts
            .filter((d) => d.document_id === document.id)
            .map((d) => (
              <li key={d.id}>
                <Link
                  className="text-primary underline"
                  href={`/admin/insurance/review/${d.id}`}
                >
                  Review {d.payload.policy_number || "extracted facts"} ·{" "}
                  {d.status}
                </Link>
              </li>
            ))}
        </ul>
      </section>
      {document.status === "ready" && <SourceDocument id={document.id} />}
    </>
  );
}

export function InsuranceNewPolicyPage() {
  const state = useInsuranceWorkspace();
  const search = useSearchParams();
  const policyId = search.get("policy_id") || "";
  const kind = search.get("kind");
  const selectedKind =
    kind === "renewal" || kind === "endorsement" || kind === "verification"
      ? kind
      : "new_policy";
  const base = state.data?.policies.find((p) => p.id === policyId);
  const sourceId = search.get("document_id") || undefined;
  return (
    <WorkspacePage
      title={
        selectedKind === "new_policy"
          ? "New policy draft"
          : `${readable(selectedKind)} draft`
      }
      state={state}
    >
      {state.data &&
        (state.data.can_manage ? (
          selectedKind !== "new_policy" && !base ? (
            <p>Policy unavailable for this draft.</p>
          ) : sourceId &&
            !state.data.documents.some(
              (d) => d.id === sourceId && d.status === "ready",
            ) ? (
            <p>Source document unavailable for this draft.</p>
          ) : (
            <PolicyDraftEditor
              key={`${policyId}:${selectedKind}:${sourceId}`}
              workspace={state.data}
              basePolicy={base as InsurancePolicy | undefined}
              initialKind={selectedKind}
              documentId={sourceId}
            />
          )
        ) : (
          <p className={panelClass}>
            Only insurance managers can create or approve policy drafts.
          </p>
        ))}
    </WorkspacePage>
  );
}
export function InsuranceDraftReviewPage() {
  const state = useInsuranceWorkspace();
  const params = useParams();
  const draft = state.data?.drafts.find((d) => d.id === params.id);
  return (
    <WorkspacePage title="Review insurance draft" state={state}>
      {state.data &&
        (state.data.can_manage && draft ? (
          <PolicyDraftEditor
            key={draft.id}
            workspace={state.data}
            draft={draft}
          />
        ) : (
          <p className={panelClass}>
            Draft unavailable in your current access scope.
          </p>
        ))}
    </WorkspacePage>
  );
}

export function InsurancePolicyPage() {
  const state = useInsuranceWorkspace();
  const params = useParams();
  const workspace = state.data;
  const policy = workspace?.policies.find((p) => p.id === params.id);
  return (
    <WorkspacePage title="Insurance policy" state={state}>
      {workspace &&
        (policy ? (
          <>
            <section className={panelClass}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    {policy.carrier_name} · {policy.policy_number}
                  </h2>
                  <p>
                    {readable(policy.policy_type)} ·{" "}
                    {policy.verification_status === "verified"
                      ? "Verified"
                      : "Unverified legacy record"}{" "}
                    · Version {policy.version || 1}
                  </p>
                </div>
                {workspace.can_manage && (
                  <div className="flex gap-4">
                    {policy.verification_status !== "verified" && (
                      <Link
                        className="text-primary underline"
                        href={`/admin/insurance/policies/new?kind=verification&policy_id=${policy.id}`}
                      >
                        Verify existing policy
                      </Link>
                    )}
                    <Link
                      className="text-primary underline"
                      href={`/admin/insurance/policies/new?kind=endorsement&policy_id=${policy.id}`}
                    >
                      Draft endorsement
                    </Link>
                    <Link
                      className="text-primary underline"
                      href={`/admin/insurance/policies/new?kind=renewal&policy_id=${policy.id}`}
                    >
                      Draft renewal
                    </Link>
                  </div>
                )}
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Policy term</dt>
                  <dd>
                    {policy.effective_date} – {policy.expiration_date}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Primary insured
                  </dt>
                  <dd>
                    {workspace.entities.find((e) => e.id === policy.entity_id)
                      ?.name || "Not included in this summary"}
                  </dd>
                </div>
                {workspace.can_manage && "premium_cents" in policy && (
                  <>
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        Stated premium
                      </dt>
                      <dd>
                        {moneyLabel(policy.premium_cents)}
                        {policy.verification_status !== "verified" &&
                          " · unverified"}
                      </dd>
                    </div>
                    {(
                      [
                        "aggregate_limit_cents",
                        "occurrence_limit_cents",
                        "deductible_cents",
                      ] as const
                    ).map((k) => (
                      <div key={k}>
                        <dt className="text-sm text-muted-foreground">
                          {readable(k.replace("_cents", ""))}
                        </dt>
                        <dd>{moneyLabel(policy[k])}</dd>
                      </div>
                    ))}
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        Limit sharing
                      </dt>
                      <dd>
                        {policy.shared_limit == null
                          ? "Unknown"
                          : policy.shared_limit
                            ? "Shared across insured locations; not a separate limit per facility"
                            : "Not shared, as reviewed"}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </section>
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">
                {workspace.can_manage
                  ? "Dated facility schedule"
                  : "Approved facility summary"}
              </h2>
              {!workspace.can_manage && (
                <p className="text-sm text-muted-foreground">
                  Only authorized, currently effective facility relationships
                  are shown. Restricted originals, premiums and other schedules
                  are excluded.
                </p>
              )}
              {policy.facilities?.length ? (
                <ul>
                  {policy.facilities.map((f, i) => (
                    <li key={`${f.facility_id}-${i}`} className="py-2">
                      {workspace.facilities.find((x) => x.id === f.facility_id)
                        ?.name || "Authorized location"}{" "}
                      · {readable(f.role)} · {f.effective_from} –{" "}
                      {f.effective_to || policy.expiration_date}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No approved facility links in the current scope.</p>
              )}
            </section>
            {workspace.can_manage && (
              <>
                <section className={panelClass}>
                  <h2 className="text-lg font-semibold">Insured parties</h2>
                  <ul>
                    {(policy.parties || []).map((p, i) => (
                      <li key={`${p.entity_id}-${i}`} className="py-2">
                        {workspace.entities.find((e) => e.id === p.entity_id)
                          ?.name || "Entity unavailable"}{" "}
                        · {readable(p.role)} · {p.effective_from} –{" "}
                        {p.effective_to || policy.expiration_date}
                      </li>
                    ))}
                  </ul>
                </section>
                <CoverageLines policy={policy} />
                <LegacyPolicyLinks policyId={policy.id} workspace={workspace} />
                <RenewalSetup
                  policyId={policy.id}
                  workspace={workspace}
                  refresh={state.refresh}
                />
                <section className={panelClass}>
                  <h2 className="text-lg font-semibold">
                    Approval and change history
                  </h2>
                  {!workspace.versions.some(
                    (v) => v.policy_id === policy.id,
                  ) ? (
                    <p>No approved version history for this legacy record.</p>
                  ) : (
                    workspace.versions
                      .filter((v) => v.policy_id === policy.id)
                      .map((v) => (
                        <HistoryVersion
                          key={v.id}
                          version={v}
                          workspace={workspace}
                        />
                      ))
                  )}
                </section>
              </>
            )}
          </>
        ) : (
          <p className={panelClass}>
            Policy unavailable in your current access scope.
          </p>
        ))}
    </WorkspacePage>
  );
}
function LegacyPolicyLinks({
  policyId,
  workspace,
}: {
  policyId: string;
  workspace: InsuranceWorkspace;
}) {
  const claims = (workspace.claims || []).filter(
    (c) => c.insurance_policy_id === policyId,
  );
  const allocations = (workspace.premium_allocations || []).filter(
    (a) => a.insurance_policy_id === policyId,
  );
  return (
    <>
      <section className={panelClass}>
        <h2 className="text-lg font-semibold">Premium allocations</h2>
        <p className="text-sm text-muted-foreground">
          Management allocations are separate from the policy premium. Existing
          allocation records retain their method and period.
        </p>
        {allocations.length ? (
          <ul>
            {allocations.map((a) => (
              <li className="py-2 text-sm" key={a.id}>
                {a.period_start} – {a.period_end} ·{" "}
                {readable(a.allocation_method)} ·{" "}
                {moneyLabel(a.allocated_premium_cents)}
              </li>
            ))}
          </ul>
        ) : (
          <p>No recorded allocations for this policy.</p>
        )}
      </section>
      <section className={panelClass}>
        <h2 className="text-lg font-semibold">Linked claims</h2>
        <p className="text-sm text-muted-foreground">
          Carrier loss figures remain separate from client retained costs.
        </p>
        {claims.length ? (
          <ul>
            {claims.map((c) => (
              <li className="py-2 text-sm" key={c.id}>
                <Link
                  className="text-primary underline"
                  href={`/admin/insurance/claims/${c.id}`}
                >
                  Open claim · {c.date_of_loss || "Loss date unknown"}
                </Link>{" "}
                · {readable(c.status)} · Paid {moneyLabel(c.paid_cents)} ·
                Reserve {moneyLabel(c.reserve_cents)}
              </li>
            ))}
          </ul>
        ) : (
          <p>No linked claims for this policy.</p>
        )}
      </section>
    </>
  );
}

function CoverageLines({ policy }: { policy: Partial<InsurancePolicy> }) {
  if (!policy.coverages?.length) return null;
  return (
    <section className={panelClass}>
      <h3 className="font-semibold">Coverage lines</h3>
      <ul>
        {policy.coverages.map((c, i) => (
          <li className="py-2 text-sm" key={i}>
            {readable(c.coverage_type)} · Occurrence{" "}
            {moneyLabel(c.occurrence_limit_cents)} · Aggregate{" "}
            {moneyLabel(c.aggregate_limit_cents)} · Deductible{" "}
            {moneyLabel(c.deductible_cents)} · Shared limit group:{" "}
            {c.shared_limit_group || "Unknown"}
          </li>
        ))}
      </ul>
    </section>
  );
}
function HistoryVersion({
  version,
  workspace,
}: {
  version: InsuranceWorkspace["versions"][number];
  workspace: InsuranceWorkspace;
}) {
  const policy = (version.snapshot || {}) as Partial<InsurancePolicy>;
  const before = (version.before_snapshot || {}) as Partial<InsurancePolicy>;
  const schedules = (p: Partial<InsurancePolicy>) => (
    <>
      <p>
        Term: {p.effective_date || "Unknown"} – {p.expiration_date || "Unknown"}
      </p>
      <p>Premium: {moneyLabel(p.premium_cents)}</p>
      {p.facilities?.map((f, i) => (
        <p key={i}>
          {workspace.facilities.find((x) => x.id === f.facility_id)?.name ||
            "Location"}{" "}
          · {readable(f.role)} · {f.effective_from} –{" "}
          {f.effective_to || p.expiration_date}
        </p>
      ))}
      <CoverageLines policy={p} />
    </>
  );
  return (
    <details className="border-t border-border py-3">
      <summary className="cursor-pointer">
        Version {version.version} ·{" "}
        {new Date(version.created_at).toLocaleString("en-US", {
          timeZone: "America/New_York",
        })}{" "}
        Eastern
        {version.change_effective_date &&
          ` · Effective ${version.change_effective_date}`}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p>
          Approved by{" "}
          {workspace.owners?.find((o) => o.id === version.approved_by)?.name ||
            "Recorded reviewer"}
        </p>
        <p>
          {policy.carrier_name || "Approved snapshot"} ·{" "}
          {policy.policy_number || ""}
        </p>
        {Boolean(version.before_snapshot) && (
          <section className={panelClass}>
            <h3 className="font-semibold">Before this approval</h3>
            {schedules(before)}
          </section>
        )}
        <section className={panelClass}>
          <h3 className="font-semibold">Approved values</h3>
          {schedules(policy)}
        </section>
        <h3 className="font-semibold">Source evidence</h3>
        <ul>
          {Object.entries(version.evidence || {}).map(([field, e]) => (
            <li key={field} className="py-2">
              <strong>{readable(field)}</strong>:{" "}
              {e.source === "manual" ? (
                e.reason
              ) : (
                <>
                  <Link
                    className="text-primary underline"
                    href={`/admin/insurance/documents/${e.document_id}`}
                  >
                    Document page {e.page}
                  </Link>{" "}
                  · {e.excerpt}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function RenewalSetup({
  policyId,
  workspace,
  refresh,
}: {
  policyId: string;
  workspace: InsuranceWorkspace;
  refresh: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [days, setDays] = useState("90, 60, 30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className={panelClass}
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");
        const parsed = days.split(",").map((s) => Number(s.trim()));
        if (
          parsed.length > 12 ||
          new Set(parsed).size !== parsed.length ||
          parsed.some((d) => !Number.isInteger(d) || d <= 0 || d > 730)
        ) {
          setError(
            "Enter up to 12 different milestones from 1 to 730 days before expiration, separated by commas.",
          );
          return;
        }
        setBusy(true);
        try {
          await insuranceCommand("configure_renewal", {
            policy_id: policyId,
            owner_id: owner,
            milestone_days: parsed,
          });
          setMessage(
            "Renewal milestones saved without duplicating existing tasks.",
          );
          refresh();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not configure renewals.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">Renewal owner and milestones</h2>
      <OwnerField
        workspace={workspace}
        value={owner}
        onChange={setOwner}
        required
      />
      <Field label="Days before expiration">
        <Input value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <Button type="submit" disabled={busy || !owner}>
        {busy ? "Saving…" : "Save renewal milestones"}
      </Button>
    </form>
  );
}
function OwnerField({
  workspace,
  value,
  onChange,
  required = false,
}: {
  workspace: InsuranceWorkspace;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <Field label="Assigned owner">
      <select
        className={controlClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">Unassigned</option>
        {workspace.owners?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function InsuranceRenewalsPage() {
  const state = useInsuranceWorkspace();
  return (
    <WorkspacePage title="Renewals and insurance work" state={state}>
      {state.data && (
        <>
          <p className={panelClass}>
            Renewal dates come from verified terms. Group policy milestones are
            tracked once, with an assigned owner and a due date.
          </p>
          {!state.data.work_items.length ? (
            <p>
              No insurance work items yet. Configure milestones from a verified
              policy.
            </p>
          ) : (
            state.data.work_items.map((item) => (
              <WorkItemEditor
                key={`${item.id}:${item.version}`}
                item={item}
                workspace={state.data!}
                refresh={state.refresh}
              />
            ))
          )}
        </>
      )}
    </WorkspacePage>
  );
}
function WorkItemEditor({
  item,
  workspace,
  refresh,
}: {
  item: WorkItem;
  workspace: InsuranceWorkspace;
  refresh: () => void;
}) {
  const [owner, setOwner] = useState(item.owner_id || "");
  const [due, setDue] = useState(item.due_date || "");
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.note || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={panelClass}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await insuranceCommand("update_work_item", {
            id: item.id,
            version: item.version,
            status,
            owner_id: owner || null,
            due_date: due || null,
            note,
          });
          refresh();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to save work item.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">{item.title}</h2>
      <p className="text-sm">
        {readable(item.kind)} · {item.status} · Due{" "}
        {item.due_date || "Unassigned"}
      </p>
      {item.policy_id && (
        <Link
          className="text-primary underline"
          href={`/admin/insurance/policies/${item.policy_id}`}
        >
          Open source policy
        </Link>
      )}
      {workspace.can_manage ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <OwnerField
              workspace={workspace}
              value={owner}
              onChange={setOwner}
            />
            <Field label="Due date">
              <Input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
            <Field label="Work status">
              <select
                className={controlClass}
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as WorkItem["status"])
                }
              >
                {["open", "completed", "dismissed"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Work note" hint="Explain completion or dismissal.">
            <textarea
              className={controlClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={status !== "open"}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save work item"}
          </Button>
        </>
      ) : (
        <p className="text-sm">
          {item.note ||
            "Contact your insurance manager to update this work item."}
        </p>
      )}
    </form>
  );
}

export function InsuranceCertificatesPage() {
  const state = useInsuranceWorkspace();
  return (
    <WorkspacePage title="Certificates of insurance" state={state}>
      {state.data && (
        <>
          <section className={panelClass}>
            <h2 className="text-lg font-semibold">
              Our coverage: request a certificate
            </h2>
            <p className="text-sm">
              A request records what the broker needs. It is not automatically
              sent or issued. Only a manager can record issuance with the issued
              certificate attached.
            </p>
            <CertificateForm workspace={state.data} refresh={state.refresh} />
          </section>
          <section className={panelClass}>
            <h2 className="text-lg font-semibold">Certificate requests</h2>
            {!state.data.certificate_requests.length ? (
              <p>No certificate requests yet.</p>
            ) : (
              state.data.certificate_requests.map((request) => (
                <CertificateEditor
                  key={`${request.id}:${request.version}`}
                  request={request}
                  workspace={state.data!}
                  refresh={state.refresh}
                />
              ))
            )}
          </section>
          <section className={panelClass}>
            <h2 className="text-lg font-semibold">Vendor evidence</h2>
            <p>
              Vendor certificates are separate from our issued certificates.
              Requirement acceptance, exceptions and vendor evidence workflows
              remain in the subsequent servicing segment.
            </p>
          </section>
        </>
      )}
    </WorkspacePage>
  );
}
function CertificateForm({
  workspace,
  refresh,
}: {
  workspace: InsuranceWorkspace;
  refresh: () => void;
}) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [facility, setFacility] = useState("");
  const [entity, setEntity] = useState("");
  const [holder, setHolder] = useState("");
  const [details, setDetails] = useState("");
  const [requirements, setRequirements] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const entities = workspace.can_manage
    ? workspace.entities
    : workspace.entities.filter((e) =>
        workspace.facilities.some(
          (f) => f.id === facility && f.entity_id === e.id,
        ),
      );
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        try {
          await insuranceCommand("create_certificate_request", {
            id,
            entity_id: entity,
            ...(facility ? { facility_id: facility } : {}),
            holder_name: holder,
            holder_details: details,
            requirements,
            ...(workspace.can_manage && owner ? { owner_id: owner } : {}),
            ...(due ? { due_date: due } : {}),
          });
          setMessage(
            "Certificate request saved. It has not been sent or issued automatically.",
          );
          setId(crypto.randomUUID());
          setHolder("");
          setDetails("");
          setRequirements("");
          refresh();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not save certificate request.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Request facility">
          <select
            className={controlClass}
            required={!workspace.can_manage}
            value={facility}
            onChange={(e) => {
              setFacility(e.target.value);
              setEntity("");
            }}
          >
            <option value="">
              {workspace.can_manage
                ? "Organization request"
                : "Choose an authorized facility"}
            </option>
            {workspace.facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Insured legal entity">
          <select
            className={controlClass}
            required
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          >
            <option value="">Choose exact insured entity</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Certificate holder name">
        <Input
          required
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
        />
      </Field>
      <Field label="Holder address and contact details">
        <textarea
          required
          className={controlClass}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </Field>
      <Field label="Certificate requirements">
        <textarea
          required
          className={controlClass}
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
        />
      </Field>
      {workspace.can_manage && (
        <OwnerField workspace={workspace} value={owner} onChange={setOwner} />
      )}
      <Field label="Requested due date">
        <Input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving request…" : "Save certificate request"}
      </Button>
    </form>
  );
}
function CertificateEditor({
  request,
  workspace,
  refresh,
}: {
  request: CertificateRequest;
  workspace: InsuranceWorkspace;
  refresh: () => void;
}) {
  const [status, setStatus] = useState(request.status);
  const [document, setDocument] = useState(request.document_id || "");
  const [note, setNote] = useState(request.note || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <article className="space-y-3 border-t border-border py-4">
      <h3 className="font-semibold">{request.holder_name}</h3>
      <p className="text-sm">
        {readable(request.status)} · Due {request.due_date || "Unassigned"}
      </p>
      <p className="whitespace-pre-wrap text-sm">{request.holder_details}</p>
      <p className="whitespace-pre-wrap text-sm">{request.requirements}</p>
      {workspace.can_manage && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await insuranceCommand("update_certificate_request", {
                id: request.id,
                version: request.version,
                status,
                ...(document ? { document_id: document } : {}),
                note,
              });
              refresh();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not update request.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={`Status for ${request.holder_name}`}>
            <select
              className={controlClass}
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as CertificateRequest["status"])
              }
            >
              {[
                "requested",
                "acknowledged",
                "needs_information",
                "issued",
                "cancelled",
              ].map((v) => (
                <option key={v} value={v}>
                  {readable(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Issued document for ${request.holder_name}`}>
            <select
              required={status === "issued"}
              className={controlClass}
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            >
              <option value="">Select stored issued certificate</option>
              {workspace.documents
                .filter(
                  (d) => d.family === "certificate" && d.status === "ready",
                )
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={`Servicing note for ${request.holder_name}`}>
            <textarea
              className={controlClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save certificate status"}
          </Button>
          {request.document_id && (
            <Link
              className="ml-3 text-primary underline"
              href={`/admin/insurance/documents/${request.document_id}`}
            >
              View issued evidence
            </Link>
          )}
        </form>
      )}
    </article>
  );
}
