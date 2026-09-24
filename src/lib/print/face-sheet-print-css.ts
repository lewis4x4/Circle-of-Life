/**
 * COL-794: Letter print rules for the resident face sheet.
 *
 * The on-screen sheet is an `max-w-3xl` (768px) column. Letter with half-inch
 * margins leaves 7.5in ≈ 720px, so the screen width overflows the page and the
 * browser either clips the right edge or shrinks the whole sheet; print drops
 * the cap and lets the sheet be the page.
 *
 * Everything else here is pagination: a face sheet is read at a transport or a
 * survey, where a heading stranded at the foot of page one, or a code-status
 * box split down the middle, is a safety problem rather than a typographic one.
 * Sections, their headings and the footer stay whole; long unbroken values
 * (email addresses, diagnosis lists) wrap instead of running off the sheet;
 * `print-color-adjust: exact` keeps the boxed code-status and allergy rules
 * from being dropped by a browser economising on ink.
 */
export const FACE_SHEET_PRINT_CSS = `
@page { size: Letter; margin: 0.5in; }

@media print {
  html, body { background: #fff; }

  #resident-face-sheet {
    max-width: none;
    width: 100%;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  #resident-face-sheet header,
  #resident-face-sheet section,
  #resident-face-sheet footer,
  #resident-face-sheet dl,
  #resident-face-sheet dt,
  #resident-face-sheet dd {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  #resident-face-sheet header,
  #resident-face-sheet h1,
  #resident-face-sheet h2 {
    break-after: avoid;
    page-break-after: avoid;
  }

  #resident-face-sheet p,
  #resident-face-sheet dd { orphans: 2; widows: 2; }

  #resident-face-sheet dd,
  #resident-face-sheet dt,
  #resident-face-sheet p,
  #resident-face-sheet span { overflow-wrap: anywhere; }

  #resident-face-sheet img {
    break-inside: avoid;
    page-break-inside: avoid;
    max-width: 100%;
  }
}
`;
