import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForPrintReady } from "./print-ready";

function sheetWithImage(): { root: HTMLElement; img: HTMLImageElement } {
  const root = document.createElement("div");
  const img = document.createElement("img");
  root.appendChild(img);
  document.body.appendChild(root);
  return { root, img };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("COL-794 waitForPrintReady", () => {
  it("waits for the sheet's images to decode before resolving", async () => {
    const { root, img } = sheetWithImage();
    let decoded = false;
    let release = () => {};
    img.decode = () =>
      new Promise<void>((resolve) => {
        release = () => {
          decoded = true;
          resolve();
        };
      });

    let done = false;
    const ready = waitForPrintReady(root).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);

    release();
    await ready;
    expect(decoded).toBe(true);
    expect(done).toBe(true);
  });

  it("still resolves when the resident photo fails to load", async () => {
    const { root, img } = sheetWithImage();
    img.decode = () => Promise.reject(new Error("404"));
    await expect(waitForPrintReady(root)).resolves.toBeUndefined();
  });

  it("falls back to load/error events when decode is unavailable", async () => {
    const { root, img } = sheetWithImage();
    // @ts-expect-error -- older engines expose no decode()
    img.decode = undefined;
    let done = false;
    const ready = waitForPrintReady(root).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    img.dispatchEvent(new Event("error"));
    await ready;
    expect(done).toBe(true);
  });

  it("skips images the browser already painted", async () => {
    const { root, img } = sheetWithImage();
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 80 });
    img.decode = vi.fn();
    await waitForPrintReady(root);
    expect(img.decode).not.toHaveBeenCalled();
  });

  it("gives up after the timeout so a hung asset never blocks the print dialog", async () => {
    const { root, img } = sheetWithImage();
    img.decode = () => new Promise<void>(() => {});
    await expect(waitForPrintReady(root, { timeoutMs: 10 })).resolves.toBeUndefined();
  });
});
