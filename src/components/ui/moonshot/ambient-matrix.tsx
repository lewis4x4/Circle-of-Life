import React from "react";

/**
 * Audit-defanged: was two `fixed h-[800px] w-[800px] blur-[120px]` radial
 * gradients pinned to the viewport corners (the "ambient matrix" backlight).
 * Renders nothing. Signature kept so consumers continue to compile.
 */
export function AmbientMatrix(_props: {
  hasCriticals?: boolean;
  primaryClass?: string;
  secondaryClass?: string;
  criticalPrimaryClass?: string;
  criticalSecondaryClass?: string;
}) {
  void _props;
  return null;
}
