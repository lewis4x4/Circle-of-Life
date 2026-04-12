"use client";

/**
 * Demo Mode Toggle
 *
 * Toggle switch for demo mode with visual indicator and localStorage persistence.
 * Shows watermark or badge when in demo mode.
 */

import React, { useState, useEffect } from "react";
import { Zap, Database } from "lucide-react";
import { cn } from "@/lib/utils";

// ── TYPES ──

export interface DemoToggleProps {
  /** Additional CSS classes */
  className?: string;
  /** Show compact version (smaller, less prominent) */
  compact?: boolean;
  /** Position of the toggle (top-right, bottom-left, etc.) */
  position?: "top-right" | "bottom-left" | "top-left" | "bottom-right";
}

// ── STORAGE KEY ──

const DEMO_MODE_STORAGE_KEY = "haven-demo-mode-enabled";

// ── MAIN COMPONENT ──

export function DemoToggle({
  className,
  compact = false,
  position = "top-right",
}: DemoToggleProps) {
  const [isEnabled, setIsEnabled] = useState(false);

  // Load saved preference on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEMO_MODE_STORAGE_KEY);
      setIsEnabled(saved === "true");
    } catch (error) {
      console.error("Failed to load demo mode preference:", error);
    }
  }, []);

  // Save preference when changed
  const handleToggle = () => {
    const newValue = !isEnabled;
    setIsEnabled(newValue);

    try {
      localStorage.setItem(DEMO_MODE_STORAGE_KEY, String(newValue));

      // Reload page to apply demo mode changes
      window.location.reload();
    } catch (error) {
      console.error("Failed to save demo mode preference:", error);
    }
  };

  // Position classes
  const positionClasses = {
    "top-right": "top-4 right-4",
    "top-left": "top-4 left-4",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
  };

  if (compact) {
    return (
      <div
        className={cn(
          "fixed z-50 flex items-center gap-2",
          positionClasses[position],
          className
        )}
      >
        <button
          onClick={handleToggle}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200",
            isEnabled
              ? "bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)]"
              : "bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300 border border-slate-700/30"
          )}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Demo</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fixed z-50",
        positionClasses[position],
        className
      )}
    >
      <div className="flex flex-col gap-2">
        {/* Demo Mode Indicator Badge */}
        {isEnabled && (
          <div className="flex items-center gap-2 px-3 py-2 bg-indigo-500/20 border border-indigo-500/30 rounded-lg">
            <Zap className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span className="text-xs font-semibold text-indigo-300">
              Demo Mode Active
            </span>
          </div>
        )}

        {/* Toggle Switch */}
        <button
          onClick={handleToggle}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl transition-all duration-300 backdrop-blur-sm",
            isEnabled
              ? "bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.5)] hover:shadow-[0_0_25px_rgba(99,102,241,0.6)]"
              : "bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 hover:text-slate-200 border border-slate-700/30"
          )}
        >
          <Database className="w-4 h-4" />
          <span>Demo Mode</span>
          <div
            className={cn(
              "w-8 h-4 rounded-full bg-slate-700 relative transition-colors",
              isEnabled && "bg-indigo-400/30"
            )}
          >
            <div
              className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-md transition-all duration-300",
                isEnabled ? "right-0.5" : "left-0.5"
              )}
            />
          </div>
        </button>
      </div>
    </div>
  );
}

// ── WATERMARK COMPONENT ──

export interface DemoWatermarkProps {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Full-screen watermark for demo mode
 */
export function DemoWatermark({ className }: DemoWatermarkProps) {
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEMO_MODE_STORAGE_KEY);
      setIsDemoMode(saved === "true");
    } catch (error) {
      console.error("Failed to load demo mode preference:", error);
    }
  }, []);

  if (!isDemoMode) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 pointer-events-none z-[100] flex items-center justify-center",
        className
      )}
    >
      <div className="text-indigo-500/10 rotate-[-15deg] select-none">
        <div className="text-[100px] font-black tracking-widest opacity-20">
          DEMO
        </div>
        <div className="text-[40px] font-bold tracking-wide opacity-15 -mt-2">
          DEMONSTRATION MODE
        </div>
      </div>
    </div>
  );
}

// ── HOOK ──

/**
 * Hook to access and manage demo mode state
 */
export function useDemoMode() {
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEMO_MODE_STORAGE_KEY);
      setIsEnabled(saved === "true");
    } catch (error) {
      console.error("Failed to load demo mode preference:", error);
    }
  }, []);

  const toggle = () => {
    const newValue = !isEnabled;
    setIsEnabled(newValue);

    try {
      localStorage.setItem(DEMO_MODE_STORAGE_KEY, String(newValue));
      window.location.reload();
    } catch (error) {
      console.error("Failed to save demo mode preference:", error);
    }
  };

  const set = (value: boolean) => {
    setIsEnabled(value);

    try {
      localStorage.setItem(DEMO_MODE_STORAGE_KEY, String(value));
      window.location.reload();
    } catch (error) {
      console.error("Failed to save demo mode preference:", error);
    }
  };

  return {
    isEnabled,
    toggle,
    set,
  };
}

// ── EXPORTS ──

export default DemoToggle;
