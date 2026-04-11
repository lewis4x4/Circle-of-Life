"use client";

import { motion, useDragControls, useMotionValue } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { GraceAvatar } from "./GraceAvatar";
import type { GraceAvatarState } from "./types";

interface GraceCornerProps {
  state: GraceAvatarState;
  onClick: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type Corner = "br" | "bl" | "tr" | "tl";

const STORAGE_KEY = "grace:avatar:position";
const PADDING = 20;

function loadCornerFromStorage(): Corner {
  if (typeof window === "undefined") return "br";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "br";
    const parsed = JSON.parse(raw) as { corner?: Corner };
    return parsed.corner ?? "br";
  } catch {
    return "br";
  }
}

function saveCornerToStorage(corner: Corner): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ corner }));
  } catch {
    // noop
  }
}

function computeCorner(x: number, y: number): Corner {
  if (typeof window === "undefined") return "br";
  const right = x > window.innerWidth / 2;
  const bottom = y > window.innerHeight / 2;
  if (bottom && right) return "br";
  if (bottom && !right) return "bl";
  if (!bottom && right) return "tr";
  return "tl";
}

function cornerStyle(corner: Corner): CSSProperties {
  const style: CSSProperties = { position: "fixed", zIndex: 9998, touchAction: "none" };
  switch (corner) {
    case "br":
      style.right = PADDING;
      style.bottom = `calc(${PADDING}px + env(safe-area-inset-bottom, 0px))`;
      break;
    case "bl":
      style.left = PADDING;
      style.bottom = `calc(${PADDING}px + env(safe-area-inset-bottom, 0px))`;
      break;
    case "tr":
      style.right = PADDING;
      style.top = `calc(${PADDING}px + env(safe-area-inset-top, 0px))`;
      break;
    case "tl":
      style.left = PADDING;
      style.top = `calc(${PADDING}px + env(safe-area-inset-top, 0px))`;
      break;
  }
  return style;
}

export function GraceCorner({
  state,
  onClick,
  collapsed = false,
  onToggleCollapsed,
}: GraceCornerProps) {
  const [corner, setCorner] = useState<Corner>(() => loadCornerFromStorage());
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const draggedRef = useRef(false);

  useEffect(() => {
    x.set(0);
    y.set(0);
  }, [corner, x, y]);

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: { point: { x: number; y: number } }) => {
      draggedRef.current = true;
      const nextCorner = computeCorner(info.point.x, info.point.y);
      setCorner(nextCorner);
      saveCornerToStorage(nextCorner);
      setTimeout(() => {
        draggedRef.current = false;
      }, 50);
    },
    [],
  );

  const handleClick = useCallback(() => {
    if (draggedRef.current) return;
    onClick();
  }, [onClick]);

  const handleDoubleClick = useCallback(() => {
    onToggleCollapsed?.();
  }, [onToggleCollapsed]);

  return (
    <motion.div
      style={{ ...cornerStyle(corner), x, y }}
      drag
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.08, cursor: "grabbing" }}
      className="group"
    >
      <GraceAvatar
        state={state}
        collapsed={collapsed}
        size={72}
        onClick={handleClick}
        ariaLabel="Open Grace companion"
      />
      {onToggleCollapsed ? (
        <button
          type="button"
          onClick={handleDoubleClick}
          className="absolute -top-2 -right-2 rounded-full border border-border bg-background px-2 py-1 text-[10px] font-semibold shadow-sm opacity-0 transition group-hover:opacity-100 focus:opacity-100"
          aria-label={collapsed ? "Expand Grace avatar" : "Collapse Grace avatar"}
        >
          {collapsed ? "+" : "-"}
        </button>
      ) : null}
    </motion.div>
  );
}
