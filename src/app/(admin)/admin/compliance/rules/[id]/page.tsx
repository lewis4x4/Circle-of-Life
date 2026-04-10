"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { type ComplianceRule, getScanHistory } from "@/lib/compliance-scan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
      // Fetch rule
      const { data: ruleData, error: ruleError } = await supabase
        .from("compliance_rules")
        .select("*")
        .eq("id", ruleId)
        .maybeSingle();

      if (ruleError || !ruleData) {
        throw new Error("Compliance rule not found");
      }

      setRule(ruleData);

      // Fetch recent scan results for this rule
      const { data: scansData } = await supabase
        .from("compliance_scans")
        .select("id")
        .order("scanned_at", { ascending: false })
        .limit(5);

      if (!scansData || scansData.length === 0) {
        setScanResults([]);
        setLoading(false);
        return;
      }

      // Get results for each scan
      const scanIds = scansData.map((s) => s.id);

      const { data: resultsData, error: resultsError } = await supabase
        .from("compliance_scan_results")
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
        return "bg-rose-500 text-white";
      case "serious":
        return "bg-red-500 text-white";
      case "standard":
        return "bg-amber-500 text-white";
      case "minor":
        return "bg-slate-500 text-white";
      default:
        return "bg-slate-500 text-white";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm text-slate-500">Loading compliance rule…</p>
      </div>
    );
  }

  if (error || !rule) {
    return (
      <Card className="border-rose-500 bg-rose-50">
        <CardContent className="py-8 text-center">
          <XCircle className="mx-auto h-12 w-12 text-rose-600 mb-4" />
          <h2 className="text-lg font-semibold text-rose-900 mb-2">
            {error || "Compliance Rule Not Found"}
          </h2>
          <Link href="/admin/compliance/rules">
            <Button variant="outline">Back to Rules</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/compliance/rules">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Compliance Rules</p>
          <h1 className="text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Tag {rule.tag_number}: {rule.tag_title}
          </h1>
        </div>
      </div>

      {/* Rule Details */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle>Rule Details</CardTitle>
              <CardDescription>{rule.rule_description}</CardDescription>
            </div>
            <Badge className={getSeverityColor(rule.severity)}>
              {rule.severity} Severity
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500 mb-1">Status</p>
              <Badge variant={rule.enabled ? "default" : "secondary"}>
                {rule.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div>
              <p className="text-slate-500 mb-1">Facility Scope</p>
              <p className="text-slate-900 dark:text-slate-100">
                {rule.facility_id ? "Facility-specific" : "Organization-wide"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm text-slate-500 mb-2">Check Query</p>
            <pre className="bg-slate-100 dark:bg-slate-900 rounded-lg p-4 text-xs overflow-x-auto">
              {rule.check_query}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Scan Results */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Scan Results</CardTitle>
            <Button variant="outline" size="sm" onClick={() => void loadRuleAndResults()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription>Last 5 scans for this rule</CardDescription>
        </CardHeader>
        <CardContent>
          {scanResults.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-4" />
              <p className="font-medium">No scan results yet</p>
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
                  className={`flex items-start gap-3 rounded-lg border p-4 ${
                    result.passed
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-rose-50 border-rose-200"
                  }`}
                >
                  <div className="mt-0.5">
                    {result.passed ? (
                      <CheckCircle className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-rose-600" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {result.passed ? "Rule Passed" : "Rule Failed"}
                      </p>
                      <span className="text-xs text-slate-500">
                        {new Date(result.created_at).toLocaleString()}
                      </span>
                    </div>
                    {!result.passed && result.non_compliant_count > 0 && (
                      <p className="text-sm text-rose-700">
                        {result.non_compliant_count} non-compliant records identified
                      </p>
                    )}
                    {result.context && Object.keys(result.context).length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 hover:underline">
                          View affected records
                        </summary>
                        <pre className="mt-2 bg-slate-100 dark:bg-slate-900 rounded p-3 text-xs overflow-x-auto">
                          {JSON.stringify(result.context, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
