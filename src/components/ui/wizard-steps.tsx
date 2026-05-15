"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * WizardSteps — accessible step indicator for multi-step flows.
 *
 * Layout: `<ol>` of `<WizardStep>` children with connector lines between.
 * Each step has explicit `state` ("complete" | "current" | "upcoming")
 * passed by the consumer; the primitive owns rendering and ARIA, not the
 * progression logic.
 *
 * Indicator numbering is automatic — the parent injects a 1-indexed
 * `index` and `isLast` (suppresses the connector after the final step)
 * into each child via `React.Children.map`. Consumers do not pass these.
 *
 * Mobile (`< sm`): only the indicator circles render; labels are hidden
 * via `hidden sm:inline` and surfaced as `aria-label` on the `<li>`.
 *
 * Accessibility:
 *   - root: semantic `<ol>` (an ordered, navigable list of steps)
 *   - current step: `aria-current="step"`
 *   - indicator + connector: `aria-hidden` (decorative)
 *
 * Usage:
 *   <WizardSteps aria-label="Onboarding progress">
 *     <WizardStep label="Overview" state="complete" href="/onboarding" />
 *     <WizardStep label="Departments" state="current"
 *                 href="/onboarding/departments" />
 *     <WizardStep label="Questions" state="upcoming"
 *                 href="/onboarding/questions" />
 *   </WizardSteps>
 *
 * This primitive is the standard for multi-step flows in Haven. Any new
 * wizard (intake, settings migration, admissions) reuses it — never roll
 * a hand-rolled `Step N of M` indicator. The CI guardrail at
 * `.github/workflows/style-regression.yml` enforces that.
 */

export type WizardStepState = "complete" | "current" | "upcoming";

type WizardStepsProps = React.OlHTMLAttributes<HTMLOListElement> & {
  "aria-label": string;
  children: React.ReactNode;
};

export function WizardSteps({ className, children, ...props }: WizardStepsProps) {
  const items = React.Children.toArray(children).filter(React.isValidElement);
  const numbered = items.map((child, idx) =>
    React.cloneElement(child as React.ReactElement<{ index?: number; isLast?: boolean }>, {
      index: idx + 1,
      isLast: idx === items.length - 1,
    }),
  );

  return (
    <ol
      role="list"
      className={cn("flex w-full items-center gap-3 sm:gap-4", className)}
      {...props}
    >
      {numbered}
    </ol>
  );
}

type WizardStepProps = {
  label: string;
  state: WizardStepState;
  href?: string;
  /** Injected by `<WizardSteps>` — do not pass manually. */
  index?: number;
  /** Injected by `<WizardSteps>` — do not pass manually. */
  isLast?: boolean;
};

export function WizardStep({ label, state, href, index, isLast }: WizardStepProps) {
  const indicator = (
    <span
      data-state={state}
      aria-hidden
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors sm:h-9 sm:w-9",
        "data-[state=complete]:bg-primary data-[state=complete]:text-primary-foreground",
        "data-[state=current]:bg-primary data-[state=current]:text-primary-foreground data-[state=current]:ring-2 data-[state=current]:ring-ring data-[state=current]:ring-offset-2 data-[state=current]:ring-offset-background",
        "data-[state=upcoming]:bg-muted data-[state=upcoming]:text-muted-foreground",
      )}
    >
      {state === "complete" ? <Check className="h-4 w-4" aria-hidden /> : index}
    </span>
  );

  const labelEl = (
    <span
      data-state={state}
      className={cn(
        "hidden text-sm transition-colors sm:inline",
        "data-[state=complete]:text-foreground",
        "data-[state=current]:font-semibold data-[state=current]:text-foreground",
        "data-[state=upcoming]:text-muted-foreground",
      )}
    >
      {label}
    </span>
  );

  const content = <span className="inline-flex items-center gap-2">{indicator}{labelEl}</span>;

  return (
    <li
      aria-current={state === "current" ? "step" : undefined}
      aria-label={label}
      className="flex flex-1 items-center gap-3 sm:gap-4 last:flex-none"
    >
      {href && state !== "current" ? (
        <Link
          href={href}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {content}
        </Link>
      ) : (
        content
      )}
      {!isLast && <span aria-hidden className="h-px flex-1 bg-border" />}
    </li>
  );
}
