"use client";

import React from "react";

/**
 * Audit-defanged: was an absolutely-positioned decorative SVG sparkline
 * with a `bottom-0 left-0 w-full h-14 opacity-15` gradient fill. Rendered
 * fake data — no consumer fed it real series. Renders nothing. Signature
 * kept so consumers continue to compile.
 */
export function Sparkline(_props: {
  colorClass?: string;
  variant?: number;
  className?: string;
}) {
  void _props;
  return null;
}
