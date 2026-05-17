# Component Rules

## Buttons

1. Primary buttons use the accent color (#678fab) with dark text. Weight 600.
2. Hover increases brightness by 8% and adds an accent-glow shadow.
3. Padding: 10px vertical, 16px horizontal. Border radius matches `--radius` (10px).
4. Secondary buttons are ghost (transparent background, 1px strong border).
5. Disabled buttons drop to 0.4 opacity and remove hover.

## Tables

1. Row height matches the per-surface density. Hover changes background, not lift.
2. Column headers use caption (11px uppercase tracked) on top borders only.
3. Status uses dot + label, never label alone.
4. Multi-select reveals a bottom action bar with copper primary button.
5. Numeric columns are right-aligned and tabular.

## Cards

1. Cards lift on hover by their per-surface `hoverLift` value, with no scale.
2. Cards earn their separation through padding and a 1px subtle border.
3. Card hover transition is 240ms with the configured cubic-bezier.
4. Nested cards are forbidden. Choose one container.

## Modals & Sheets

1. Modals raise the dimmed overlay, never blur it further.
2. Modals do not exceed 640px on the long axis without strong justification.
3. Primary action sits bottom-right; destructive uses `--danger` background.
4. Esc closes by default. Enter only triggers the primary action when no input is focused.

## Inputs

1. Inputs use `--bg` background with a strong border. Focus reveals a 3px glow.
2. Required-field indication is visual (asterisk) and programmatic (aria-required).
3. Error states use `--danger` with a one-line message under the field.
4. Help text is body-sm muted, never italic.
