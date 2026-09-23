/**
 * Compile-time guard (COL-658), checked by `npm run typecheck`; never
 * imported. Icon-size buttons and select triggers must be given an
 * accessible name — each `@ts-expect-error` fails the build if the
 * requirement is ever loosened.
 */
import { Button } from "@/components/ui/button";
import { SelectTrigger } from "@/components/ui/select";

export const namedIconButton = <Button size="icon" aria-label="Refresh" />;
export const labelledIconButton = <Button size="icon-sm" aria-labelledby="refresh-label" />;
export const textButton = <Button size="sm">Refresh</Button>;
// @ts-expect-error icon-only size without aria-label / aria-labelledby
export const unnamedIconButton = <Button size="icon" />;

export const triggerBoundToLabel = <SelectTrigger id="severity" />;
export const triggerWithAriaLabel = <SelectTrigger aria-label="Severity" />;
// @ts-expect-error trigger with neither id, aria-label nor aria-labelledby
export const unnamedTrigger = <SelectTrigger />;
