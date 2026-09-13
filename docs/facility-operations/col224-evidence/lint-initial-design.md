# Initial clock initialization feedback

The first narrow Date|null implementation updated state synchronously inside its mount effect. Its 10 focused tests passed, but targeted ESLint exited 1 at hero line21: `react-hooks/set-state-in-effect` — "Calling setState synchronously within an effect can trigger cascading renders". This version did not pass lint and was not accepted.

The corrected implementation schedules only the initial clock update through a zero-delay callback and clears it on unmount, retaining the existing 60-second interval and refresh event. No lint rule or hydration warning was disabled. The original failing hydration regression log remains separate.
