"use client";

import { GraceAvatar } from "./GraceAvatar";
import type { GraceAvatarState } from "./types";

interface GraceCornerProps {
  state: GraceAvatarState;
  onClick: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function GraceCorner({
  state,
  onClick,
  collapsed = false,
}: GraceCornerProps) {
  return (
    <div className="fixed bottom-5 right-5 z-[9998]">
      <GraceAvatar
        state={state}
        collapsed={collapsed}
        size={44}
        onClick={onClick}
        ariaLabel="Open Grace companion"
      />
    </div>
  );
}
