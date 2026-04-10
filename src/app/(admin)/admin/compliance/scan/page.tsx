"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, RefreshCw, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  runComplianceScan,
  getScanHistory,
  type ComplianceScanSummary,
} from "@/lib/compliance-scan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ComplianceScanPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ComplianceScanSummary | null>(null);
  const [history, setHistory] = useState<typeof runComplianceScan.returnType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const loadHistory = useCallback(async () => {
    if (!facilityReady) {
      setHistory(null);
      return;
    }

    try {
      const historyData = await getScanHistory(selectedFacilityId!, 10);
      setHistory(historyData);
    } catch (e) {
      console.error("Failed to load scan history:", e);
      setHistory([]);
    }
  }, [selectedFacilityId, facilityReady]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const runScan = useCallback(async () => {
    if (!facilityReady || running) return;

    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("Not authenticated");
      }

      const scanResult = await runComplianceScan(selectedFacilityId!, user.id);
      setResult(scanResult);

      // Reload history after scan
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setRunning(false);
    }
  }, [facilityReady, selectedFacilityId, running, loadHistory, supabase]);

  const getScoreColor = (percentage: number) => {
    if (percentage === 100) return "text-emerald-600 dark:text-emerald-400";
    if (percentage >= 75) return "text-amber-600 dark:text-amber-400";
    return "text-rose-600 dark:text-rose-400";
  };

  const getScoreBg = (percentage: number) => {
    if (percentage === 100) return "bg-emerald-500/10 border-emerald-500";
    if (percentage >= 75) return "bg-amber-500/10 border-amber-500";
    return "bg-rose-500/10 border-rose-500";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Compliance Scoring</p>
          <h1 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Compliance Scan
          </h1>
        </div>
        <Button
          onClick={() => void runScan()}
          disabled={!facilityReady || running}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          <Play className="mr-2 h-4 w-4" />
          {running ? "Scanning…" : "Run Compliance Scan"}
        </Button>
      </div>

      {!facilityReady && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle>Select a Facility</CardTitle>
            <CardDescription>Choose a facility to run a compliance scan.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500 bg-rose-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-5 w-5 text-rose-600" />
              <div>
                <p className="font-semibold text-rose-900">Scan Error</p>
                <p className="text-sm text-rose-700">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {result && result.scan && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Scan Results</CardTitle>
              <Badge variant="outline" className="text-sm">
                {new Date(result.scan.scanned_at).toLocaleString()}
              </Badge>
            </div>
            <CardDescription>
              {result.scan.total_rules_checked} rules checked •{" "}
              {result.scan.rules_passed} passed •{" "}
              {result.scan.rules_failed} failed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Score Summary */}
            <div
              className={`rounded-xl border p-6 text-center ${getScoreBg(
                Math.round((result.scan.rules_passed / result.scan.total_rules_checked) * 100)
              )}`}
            >
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                Compliance Score
              </p>
              <p
                className={`text-5xl font-bold ${getScoreColor(
                  Math.round((result.scan.rules_passed / result.scan.total_rules_checked) * 100)
                )}`}
              >
                {Math.round((result.scan.rules_passed / result.scan.total_rules_checked) * 100)}%
              </p>
            </div>

            {/* Rule Results */}
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">Rule Results</h3>
              <div className="space-y-2">
                {result.results.map((r) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      r.passed
                        ? "bg-emerald-50 border-emerald-200"
                        : "bg-rose-50 border-rose-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {r.passed ? (
                        <CheckCircle className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-rose-600" />
                      )}
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          Tag {r.tag_number}
                        </p>
                        {!r.passed && r.non_compliant_count > 0 && (
                          <p className="text-sm text-rose-700">
                            {r.non_compliant_count} non-compliant records found
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan History */}
      {history && history.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Scan History</CardTitle>
              <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription>Recent compliance scans for this facility</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {history.map((scan) => {
                const percentage = Math.round((scan.rules_passed / scan.total_rules_checked) * 100);
                return (
                  <li
                    key={scan.id}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    <div className="flex items-center gap-3">
                      {percentage === 100 ? (
                        <CheckCircle className="h-5 w-5 text-emerald-600" />
                      ) : percentage >= 75 ? (
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-rose-600" />
                      )}
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {new Date(scan.scanned_at).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-slate-500">
                          {scan.rules_passed}/{scan.total_rules_checked} rules passed
                        </p>
                      </div>
                    </div>
                    <Badge
                      className={percentage === 100 ? "bg-emerald-500 text-white" : percentage >= 75 ? "bg-amber-500 text-white" : "bg-rose-500 text-white"}
                    >
                      {percentage}%
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
