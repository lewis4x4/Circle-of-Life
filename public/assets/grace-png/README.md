Grace avatar assets live in this folder.

The app currently ships with SVG defaults:

- `grace-idle.svg`
- `grace-thinking.svg`
- `grace-speaking.svg`
- `grace-listening.svg`
- `grace-alert.svg`

Recommended replacement asset spec:

- 512x512
- Transparent background
- Soft purple/teal palette
- Consistent framing across all states

If you replace these with custom artwork, keep the same filenames or update
`src/lib/grace/GraceAvatar.tsx`.

Grace also reuses:

- `grace-thinking.svg` for the `flow_active` state
- `grace-speaking.svg` for the `success` state
