/**
 * COL-794: hold the print dialog until the sheet is actually paintable.
 *
 * `window.print()` snapshots the document as it stands. A sheet that opens the
 * dialog on a fixed timer can be snapshotted mid-layout — fallback metrics
 * instead of the real font, a resident photo that has not decoded — and the
 * paper copy comes out reflowed or with a hole where the photo should be.
 *
 * So wait for the two things that move layout after first paint: web fonts and
 * images. Neither may block printing forever — a photo URL that 404s must still
 * produce a sheet — so everything races a timeout and a failed image resolves
 * like a loaded one. The caller always gets a resolved promise.
 */
export const PRINT_READY_TIMEOUT_MS = 3000;

function imageSettled(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  const decoded = typeof img.decode === "function" ? img.decode() : null;
  if (decoded) return decoded.then(() => undefined).catch(() => undefined);
  return new Promise<void>((resolve) => {
    const done = () => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
      resolve();
    };
    img.addEventListener("load", done);
    img.addEventListener("error", done);
  });
}

export async function waitForPrintReady(
  root: ParentNode | null | undefined,
  { timeoutMs = PRINT_READY_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<void> {
  const waits: Promise<unknown>[] = [];

  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (fonts?.ready) waits.push(Promise.resolve(fonts.ready).catch(() => undefined));

  if (root) {
    for (const img of Array.from(root.querySelectorAll("img"))) waits.push(imageSettled(img));
  }

  if (waits.length === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.all(waits).then(() => undefined), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
