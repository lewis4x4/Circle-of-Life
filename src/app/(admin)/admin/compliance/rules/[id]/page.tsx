"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { type ComplianceRule } from "@/lib/compliance-scan";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";

type ScanResult = {
  id: string;
  scan_id: string;
  passed: boolean;
  non_compliant_count: number;
  created_at: string;
  context: Record<string, unknown> | null;
};

export default function ComplianceRuleDetailPage() {
  const params = useParams<{ id: string }>();
  const ruleId = params.id;
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rule, setRule] = useState<ComplianceRule | null>(null);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadRuleAndResults = useCallback(async () => {
    if (!ruleId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: ruleData, error: ruleError } = await supabase
        .from("compliance_rules" as never)
        .select("*")
        .eq("id", ruleId)
        .maybeSingle();

      if (ruleError || !ruleData) {
        throw new Error("Compliance rule not found");
      }

      setRule(ruleData);

      const { data: scansData } = await supabase
        .from("compliance_scans" as never)
        .select("id")
        .order("scanned_at", { ascending: false })
        .limit(5);

      if (!scansData || scansData.length === 0) {
        setScanResults([]);
        setLoading(false);
        return;
      }

      const scanIds = scansData.map((s: { id: string }) => s.id);

      const { data: resultsData, error: resultsError } = await supabase
        .from("compliance_scan_results" as never)
        .select("*")
        .eq("rule_id", ruleId)
        .in("scan_id", scanIds)
        .order("created_at", { ascending: false });

      if (resultsError) {
        console.error("Failed to fetch scan results:", resultsError);
        setScanResults([]);
      } else {
        setScanResults((resultsData as ScanResult[]) || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rule");
    } finally {
      setLoading(false);
    }
  }, [ruleId, supabase]);

  useEffect(() => {
    void loadRuleAndResults();
  }, [loadRuleAndResults]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "immediate_jeopardy":
        return "bg-destructive text-white";
      case "serious":
        return "bg-destructive text-white";
      case "standard":
        return "bg-warning text-white";
      case "minor":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm text-muted-foreground">Loading compliance rule…</p>
      </div>
    );
  }

  if (error || !rule) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10">
        <div className="py-8 text-center px-4">
          <XCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {error || "Compliance Rule Not Found"}
          </h2>
          <Link href="/admin/compliance/rules">
            <Button variant="outline">Back to Rules</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RecordDetailHeader
        title={`Tag ${rule.tag_number}: ${rule.tag_title}`}
        backLink={{ label: "Rules", href: "/admin/compliance/rules" }}
        statusChips={
          <Badge className={getSeverityColor(rule.severity)}>
            {rule.severity} Severity
          </Badge>
        }
      />

      <RecordDetailSection title="Rule details">
        <p className="text-sm text-muted-foreground">{rule.rule_description}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground mb-1">Status</p>
            <Badge variant={rule.enabled ? "default" : "secondary"}>
              {rule.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Facility Scope</p>
            <p className="text-foreground">
              {rule.facility_id ? "Facility-specific" : "Organization-wide"}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm text-muted-foreground mb-2">Check Query</p>
          <pre className="bg-muted rounded-[8px] p-4 text-xs overflow-x-auto text-foreground">
            {rule.check_query}
          </pre>
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Recent scan results"
        action={
          <Button variant="outline" size="sm" onClick={() => void loadRuleAndResults()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground mb-3">Last 5 scans for this rule</p>
        {scanResults.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto h-10 w-10 text-warning mb-4" />
            <p className="font-medium text-foreground">No scan results yet</p>
            <p className="text-sm mt-1">
              Run a compliance scan to generate results for this rule.
            </p>
            <Link href="/admin/compliance/scan" className="mt-4 inline-block">
              <Button>Run Scan</Button>
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {scanResults.map((result) => (
              <li
                key={result.id}
                className={`flex items-start gap-3 rounded-[8px] border p-4 ${
                  result.passed
                    ? "bg-success/10 border-success/20"
                    : "bg-destructive/10 border-destructive/20"
                }`}
              >
                <div className="mt-0.5">
                  {result.passed ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-foreground">
                      {result.passed ? "Rule Passed" : "Rule Failed"}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {new Date(result.created_at).toLocaleString()}
                    </span>
                  </div>
                  {!result.passed && result.non_compliant_count > 0 && (
                    <p className="text-sm text-destructive">
                      {result.non_compliant_count} non-compliant records identified
                    </p>
                  )}
                  {result.context && Object.keys(result.context).length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View affected records
                      </summary>
                      <pre className="mt-2 bg-muted rounded-[8px] p-3 text-xs overflow-x-auto text-foreground">
                        {JSON.stringify(result.context, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </RecordDetailSection>
    </div>
  );
}
