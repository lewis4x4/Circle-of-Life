"use client";

import { useState } from "react";
import { ThermometerSun, Mic } from "lucide-react";

export function VoiceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [recording, setRecording] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-stone-900 ring-1 ring-stone-700 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ThermometerSun className="w-5 h-5 text-orange-400" />
            <h2 className="text-base font-semibold text-white">Voice HACCP Log</h2>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-8 flex flex-col items-center text-center">
          <button
            onMouseDown={() => setRecording(true)}
            onMouseUp={() => setRecording(false)}
            onMouseLeave={() => setRecording(false)}
            onTouchStart={() => setRecording(true)}
            onTouchEnd={() => setRecording(false)}
            className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all select-none ${
              recording
                ? "bg-rose-500 scale-110 shadow-2xl shadow-rose-500/50"
                : "bg-orange-500 hover:bg-orange-400 shadow-xl shadow-orange-500/40"
            }`}
          >
            {recording && (
              <div className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-40" />
            )}
            <Mic className="w-14 h-14 text-white relative" />
          </button>

          <h3 className="text-base font-semibold text-white mt-5">
            {recording ? "Listening…" : "Hold to speak"}
          </h3>
          <p className="text-sm text-stone-400 mt-1 max-w-xs">
            &quot;Beef stew, hot hold, one fifty-eight.&quot;
          </p>

          {recording && (
            <div className="mt-5 flex items-end gap-1 h-10">
              {[...Array(16)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-rose-400 rounded-full animate-pulse"
                  style={{
                    height: `${18 + Math.abs(Math.sin(i * 0.7)) * 22}px`,
                    animationDelay: `${i * 55}ms`,
                  }}
                />
              ))}
            </div>
          )}

          <div className="mt-6 w-full grid grid-cols-2 gap-2">
            <button
              onClick={onClose}
              className="py-2.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={onClose}
              className="py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-stone-950 text-sm font-semibold transition"
            >
              Save log
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
