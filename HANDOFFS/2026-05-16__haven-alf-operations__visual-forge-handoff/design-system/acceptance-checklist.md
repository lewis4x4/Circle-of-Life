# Acceptance Checklist

A built screen passes only if every box below is checked.

## Visual quality

- [ ] The screen does not look like a generic SaaS template.
- [ ] The accent color appears only where the design system specifies.
- [ ] No banned font (Inter, Söhne, Roboto, Arial) appears anywhere.
- [ ] No glassmorphism, bento grids, or floating-card soft-shadow layouts.

## Hierarchy

- [ ] The main action is obvious within five seconds.
- [ ] Hierarchy is created through weight and size, not color.

## Density

- [ ] Row heights match the specified density.
- [ ] Information density matches consequence level.

## States

- [ ] Loading, empty, error, and critical states are designed per the surface map.

## Anti-patterns

- [ ] None of the items in anti-patterns.md appear on this screen.

## Implementation

- [ ] Tokens are consumed via CSS variables and the Tailwind theme extension.
- [ ] Accessibility minimum: WCAG AA contrast, visible focus states, keyboard navigation.
