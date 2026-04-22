"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Play, TrendingUp } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  getComplianceScore,
  getLatestScan,
  type ComplianceRule,
} from "@/lib/compliance-scan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type RuleSummary = {
  id: string;
  tag_number: string;
  tag_title: string;
  severity: string;
  enabled: boolean;
  last_result?: {
    passed: boolean;
    scanned_at: string;
  };
};

export default function ComplianceRulesPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [score, setScore] = useState<{ percentage: number; passed: number; total: number } | null>(null);
  const [scanDate, setScanDate] = useState<string | null>(null);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const loadRules = useCallback(async () => {
    if (!facilityReady) {
      setRules([]);
      setScore(null);
      setScanDate(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Fetch rules
      const { data: rulesData, error: rulesError } = await supabase
        .from("compliance_rules" as never)
        .select("id, tag_number, tag_title, severity, enabled")
        .or(`facility_id.eq.${selectedFacilityId},facility_id.is.null`)
        .eq("enabled", true)
        .is("deleted_at", null)
        .order("tag_number", { ascending: true });

      if (rulesError) {
        console.error("Failed to fetch rules:", rulesError);
        setRules([]);
        return;
      }

      // Fetch latest scan results
      const latestScan = await getLatestScan(selectedFacilityId);
      const scanResult = await getComplianceScore(selectedFacilityId);

      if (latestScan) {
        setScanDate(latestScan.scan.scanned_at);
      }

      setScore(scanResult);

      // Build rule summary with last result
      const summary: RuleSummary[] = (rulesData || []).map((rule: ComplianceRule) => {
        const lastResult = latestScan?.results.find((r) => r.rule_id === rule.id);
        return {
          id: rule.id,
          tag_number: rule.tag_number,
          tag_title: rule.tag_title,
          severity: rule.severity,
          enabled: rule.enabled,
          last_result: lastResult
            ? {
                passed: lastResult.passed,
                scanned_at: latestScan?.scan.scanned_at ?? "",
              }
            : undefined,
        };
      });

      setRules(summary);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, facilityReady, supabase]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

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
        <p className="text-sm text-slate-500">Loading compliance rules…</p>
      </div>
    );
  }

  if (!facilityReady) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle>Select a Facility</CardTitle>
          <CardDescription>Choose a facility to view compliance rules and run scans.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Compliance Rules</p>
          <h1 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Compliance Scoring
          </h1>
        </div>
        <div className="flex gap-3">
          <Link href="/admin/compliance/scan">
            <Button>
              <Play className="mr-2 h-4 w-4" />
              Run Scan
            </Button>
          </Link>
          <Link href="/admin/compliance/rules/new">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Add Rule
            </Button>
          </Link>
        </div>
      </div>

      {/* Score Card */}
      {score && (
        <Card className={score.percentage === 100 ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20" : score.percentage >= 75 ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" : "border-rose-500 bg-rose-50 dark:bg-rose-950/20"}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Compliance Score
              </CardTitle>
              <Badge className="text-lg font-bold px-4 py-2">
                {score.percentage}%
              </Badge>
            </div>
            <CardDescription>
              {score.passed} of {score.total} rules passing
              {scanDate && ` • Last scan: ${new Date(scanDate).toLocaleDateString()}`}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Rules List */}
      <div className="space-y-3">
        <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
          AHCA Tag Rules
        </h2>
        {rules.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-slate-500">
              <p className="font-medium">No compliance rules configured</p>
              <p className="text-sm mt-1">Add rules to enable automated compliance scoring.</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {rules.map((rule) => (
              <li key={rule.id}>
                <Card className="group transition-all hover:border-indigo-300">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          <Badge className={getSeverityColor(rule.severity)}>
                            Tag {rule.tag_number}
                          </Badge>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                            {rule.tag_title}
                          </h3>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {rule.severity} severity rule
                        </p>
                        {rule.last_result && (
                          <div className="flex items-center gap-2 text-sm">
                            <span
                              className={`px-2 py-1 rounded text-white ${
                                rule.last_result.passed ? "bg-emerald-500" : "bg-rose-500"
                              }`}
                            >
                              {rule.last_result.passed ? "PASS" : "FAIL"}
                            </span>
                            <span className="text-slate-500">
                              Scanned {new Date(rule.last_result.scanned_at).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                      <Link
                        href={`/admin/compliance/rules/${rule.id}`}
                        className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                      >
                        View Details →
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
