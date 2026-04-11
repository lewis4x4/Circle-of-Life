"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import type { GraceAvatarState } from "./types";

export interface GraceAvatarProps {
  state: GraceAvatarState;
  size?: number;
  collapsed?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

const STATE_TO_SRC: Record<GraceAvatarState, string> = {
  idle: "/assets/grace/grace-idle.svg",
  thinking: "/assets/grace/grace-thinking.svg",
  speaking: "/assets/grace/grace-speaking.svg",
  listening: "/assets/grace/grace-listening.svg",
  alert: "/assets/grace/grace-alert.svg",
  flow_active: "/assets/grace/grace-thinking.svg",
  success: "/assets/grace/grace-speaking.svg",
};

const STATE_TO_LABEL: Record<GraceAvatarState, string> = {
  idle: "Grace ready",
  thinking: "Grace thinking",
  speaking: "Grace speaking",
  listening: "Grace listening",
  alert: "Grace alert",
  flow_active: "Grace flow in progress",
  success: "Grace completed action",
};

const BREATHE_ANIMATION = {
  scale: [1, 1.02, 1],
  transition: { duration: 4, repeat: Infinity, ease: "easeInOut" as const },
};

const ALERT_BOB = {
  y: [0, -3, 0],
  transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" as const },
};

function ringShadow(state: GraceAvatarState): string {
  switch (state) {
    case "alert":
      return "0 0 24px 4px rgba(245, 158, 11, 0.55)";
    case "listening":
      return "0 0 24px 4px rgba(45, 212, 191, 0.45)";
    case "speaking":
      return "0 0 28px 6px rgba(168, 85, 247, 0.5)";
    case "thinking":
    case "flow_active":
      return "0 0 22px 4px rgba(94, 234, 212, 0.4)";
    case "success":
      return "0 0 26px 5px rgba(52, 211, 153, 0.5)";
    default:
      return "0 0 16px 2px rgba(15, 23, 42, 0.25)";
  }
}

export function GraceAvatar({
  state,
  size = 72,
  collapsed = false,
  onClick,
  ariaLabel,
  className = "",
}: GraceAvatarProps) {
  const reduceMotion = useReducedMotion();
  const src = STATE_TO_SRC[state];
  const label = ariaLabel ?? STATE_TO_LABEL[state];
  const effectiveSize = collapsed ? 28 : size;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageFailed = failedSrc === src;

  const idleAnimation = useMemo(() => {
    if (reduceMotion) return undefined;
    if (state === "idle") return BREATHE_ANIMATION;
    if (state === "alert") return ALERT_BOB;
    return undefined;
  }, [reduceMotion, state]);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`relative inline-flex items-center justify-center rounded-full select-none ${className}`}
      style={{ width: effectiveSize, height: effectiveSize }}
      animate={idleAnimation}
      whileHover={reduceMotion ? undefined : { scale: 1.05 }}
      whileTap={reduceMotion ? undefined : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{ boxShadow: ringShadow(state), transition: "box-shadow 300ms ease" }}
      />

      <AnimatePresence mode="wait" initial={false}>
        {imageFailed ? (
          <motion.div
            key={`${state}-fallback`}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="relative flex items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-teal-400 font-semibold text-white"
            style={{ width: effectiveSize, height: effectiveSize }}
          >
            G
          </motion.div>
        ) : (
          <motion.img
            key={state}
            src={src}
            alt=""
            draggable={false}
            onError={() => setFailedSrc(src)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="relative rounded-full bg-slate-900/5 object-cover"
            style={{ width: effectiveSize, height: effectiveSize }}
          />
        )}
      </AnimatePresence>

      {state === "alert" && !collapsed && (
        <motion.div
          aria-hidden
          className="absolute rounded-full bg-amber-400 ring-2 ring-white dark:ring-slate-950"
          style={{
            top: "14%",
            right: "18%",
            width: Math.max(8, effectiveSize * 0.14),
            height: Math.max(8, effectiveSize * 0.14),
            boxShadow: "0 0 10px 2px rgba(245, 158, 11, 0.8)",
          }}
          initial={{ scale: 0 }}
          animate={reduceMotion ? { scale: 1 } : { scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}

      {(state === "thinking" || state === "flow_active") && !collapsed && !reduceMotion && (
        <>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            animate={{
              boxShadow: [
                "0 0 12px 2px rgba(45,212,191,0.25), 0 0 24px 6px rgba(168,85,247,0.15)",
                "0 0 28px 6px rgba(45,212,191,0.45), 0 0 48px 14px rgba(168,85,247,0.25)",
                "0 0 12px 2px rgba(45,212,191,0.25), 0 0 24px 6px rgba(168,85,247,0.15)",
              ],
            }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute rounded-full"
            style={{
              inset: -6,
              background:
                "conic-gradient(from 0deg, rgba(45,212,191,0) 0deg, rgba(45,212,191,0.85) 60deg, rgba(168,85,247,1) 120deg, rgba(45,212,191,0.85) 180deg, rgba(45,212,191,0) 220deg, rgba(45,212,191,0) 360deg)",
              WebkitMask:
                "radial-gradient(circle, transparent 52%, black 54%, black 68%, transparent 70%)",
              mask:
                "radial-gradient(circle, transparent 52%, black 54%, black 68%, transparent 70%)",
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          />
        </>
      )}

      {state === "listening" && !collapsed && !reduceMotion && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-teal-400"
          initial={{ scale: 0.9, opacity: 0.6 }}
          animate={{ scale: 1.25, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {state === "success" && !collapsed && !reduceMotion && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-400"
          initial={{ scale: 0.9, opacity: 0.7 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
        />
      )}
    </motion.button>
  );
}
