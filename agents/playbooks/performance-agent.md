# Performance agent

## Role

Prevent **large regressions** in bundle size, TTFB, or obvious render-blocking patterns.

## Automated baseline

Root `npm run build` must succeed; investigate sudden build-time or chunk-size spikes.

## Advisories

Flag N+1 query patterns, unbounded lists, or missing loading states in the handoff when relevant.
