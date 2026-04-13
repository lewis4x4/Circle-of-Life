"use client";

import { useState } from "react";
import {
  ShieldCheck,
  ScanLine,
  Shield,
  CheckCircle2,
  Activity,
  Mic,
  Fingerprint,
  Heart,
  Waves,
  Thermometer,
  Droplet,
  Bluetooth,
  Radio,
} from "lucide-react";

import type { MedPassItem } from "../PassCard";

export function MedPassModal({
  pass,
  onClose,
}: {
  pass: MedPassItem;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0); // 0 scan, 1 sweep, 2 voice, 3 witness, 4 done
  const [recording, setRecording] = useState(false);

  const steps = pass.controlled
    ? ["Scan", "Safety Sweep", "Voice Chart", "Witness", "Confirm"]
    : ["Scan", "Safety Sweep", "Voice Chart", "Confirm"];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-3xl bg-slate-900 ring-1 ring-slate-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-slate-800 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-slate-400">
                Room {pass.room}
              </span>
              {pass.controlled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-300 text-[10px] font-bold ring-1 ring-violet-500/40">
                  <ShieldCheck className="w-3 h-3" /> SCHEDULE II
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold text-white">
              {pass.resident}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {pass.med} · {pass.dose} · scheduled {pass.time}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none"
          >
            x
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 py-3 flex gap-2 border-b border-slate-800">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition ${
                i <= step
                  ? "bg-gradient-to-r from-violet-500 to-sky-500"
                  : "bg-slate-800"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="p-6 min-h-[380px]">
          {/* Step 0: Scan */}
          {step === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="relative w-32 h-32 mb-6">
                <div className="absolute inset-0 rounded-full bg-sky-500/20 animate-ping" />
                <div className="relative w-32 h-32 rounded-full bg-sky-500/10 ring-2 ring-sky-500/50 flex items-center justify-center">
                  <ScanLine className="w-14 h-14 text-sky-400" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-white">
                Scan wristband, then pack
              </h3>
              <p className="text-sm text-slate-400 mt-1 max-w-sm">
                Point camera at resident&apos;s wristband barcode. Pack scan
                follows automatically.
              </p>
              <div className="mt-6 flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Bluetooth className="w-3.5 h-3.5 text-sky-400" /> Cart
                  beacon · 8.2 ft
                </span>
                <span className="flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-emerald-400" /> Room{" "}
                  {pass.room} beacon · 4.1 ft
                </span>
              </div>
              <button
                onClick={() => setStep(1)}
                className="mt-6 px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold transition"
              >
                Simulate scan
              </button>
            </div>
          )}

          {/* Step 1: Safety Sweep */}
          {step === 1 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">
                  Five Rights · Verified
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {[
                  "Right Patient",
                  "Right Drug",
                  "Right Dose",
                  "Right Route",
                  "Right Time",
                ].map((r) => (
                  <div
                    key={r}
                    className="flex items-center gap-2 rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30 px-3 py-2.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-sm text-emerald-200">{r}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-semibold text-sky-300 uppercase tracking-wider">
                  Pre-Pass Sweep
                </h3>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { Icon: Heart, label: "BP", val: "132/84" },
                  { Icon: Waves, label: "HR", val: "76" },
                  { Icon: Thermometer, label: "Temp", val: "98.4" },
                  { Icon: Droplet, label: "SpO2", val: "97%" },
                ].map((v) => (
                  <div
                    key={v.label}
                    className="rounded-lg bg-slate-800/60 ring-1 ring-slate-700 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase tracking-wider">
                      <v.Icon className="w-3 h-3" />
                      {v.label}
                    </div>
                    <div className="text-base font-mono text-white mt-0.5">
                      {v.val}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30 px-4 py-3 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div className="text-sm text-emerald-200">
                  No holds · no allergies triggered · cleared to administer
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold transition"
                >
                  Continue to Voice Chart
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Voice Chart */}
          {step === 2 && (
            <div className="flex flex-col items-center justify-center text-center py-6">
              <button
                onMouseDown={() => setRecording(true)}
                onMouseUp={() => setRecording(false)}
                onMouseLeave={() => setRecording(false)}
                className={`relative w-36 h-36 rounded-full flex items-center justify-center transition-all ${
                  recording
                    ? "bg-rose-500 scale-110 shadow-2xl shadow-rose-500/50"
                    : "bg-violet-500 hover:bg-violet-400 shadow-xl shadow-violet-500/40"
                }`}
              >
                {recording && (
                  <div className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-40" />
                )}
                <Mic className="w-16 h-16 text-white relative" />
              </button>
              <h3 className="text-lg font-semibold text-white mt-6">
                {recording ? "Listening..." : "Hold to speak"}
              </h3>
              <p className="text-sm text-slate-400 mt-1 max-w-sm">
                &ldquo;Giving {pass.resident.split(",")[0]} their {pass.time}{" "}
                {pass.med} {pass.dose}.&rdquo;
              </p>

              {recording && (
                <div className="mt-5 flex items-end gap-1 h-10">
                  {[...Array(18)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-rose-400 rounded-full animate-pulse"
                      style={{
                        height: `${20 + Math.abs(Math.sin(i)) * 24}px`,
                        animationDelay: `${i * 50}ms`,
                      }}
                    />
                  ))}
                </div>
              )}

              <button
                onClick={() => setStep(pass.controlled ? 3 : steps.length - 1)}
                className="mt-8 px-6 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition"
              >
                Transcript looks good
              </button>
            </div>
          )}

          {/* Step 3: Witness (controlled only) */}
          {step === 3 && pass.controlled && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Fingerprint className="w-5 h-5 text-violet-400" />
                <h3 className="text-sm font-semibold text-violet-300 uppercase tracking-wider">
                  Witness Required · Schedule II
                </h3>
              </div>
              <div className="rounded-xl bg-slate-800/60 ring-1 ring-slate-700 p-5 mb-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center text-white font-semibold text-sm">
                    JR
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">
                      Jamila Roberts, RN
                    </div>
                    <div className="text-xs text-slate-400">
                      On shift · within 15 ft · ready
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "<-"].map((n, i) => (
                    <button
                      key={i}
                      className="aspect-square rounded-xl bg-slate-900 ring-1 ring-slate-700 hover:ring-violet-500 text-white text-xl font-semibold transition disabled:opacity-30"
                      disabled={n === ""}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex justify-center gap-2">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full ${
                        i <= 3 ? "bg-violet-400" : "bg-slate-700"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setStep(steps.length - 1)}
                  className="px-6 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition"
                >
                  Witness confirmed
                </button>
              </div>
            </div>
          )}

          {/* Final Step: Confirm */}
          {step === steps.length - 1 && (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <div className="w-24 h-24 rounded-full bg-emerald-500/20 ring-2 ring-emerald-500 flex items-center justify-center mb-5">
                <CheckCircle2 className="w-14 h-14 text-emerald-400" />
              </div>
              <h3 className="text-2xl font-semibold text-white">
                Administered
              </h3>
              <p className="text-sm text-slate-400 mt-2">
                MAR signed · transcript saved · tape updated
              </p>
              <div className="mt-4 text-xs text-slate-500 font-mono">
                time-to-chart · 47s
              </div>
              <button
                onClick={onClose}
                className="mt-8 px-8 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold transition"
              >
                Back to cockpit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
