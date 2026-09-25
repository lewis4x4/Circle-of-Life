"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { AdminErrorState } from "@/components/common/admin-list-patterns";
import type { IntakeItem } from "@/lib/document-intake/contracts";

import { sourceUrl } from "./api";

type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;

export type PdfState = { status: "idle" | "loading" | "ready" | "error"; doc: PdfDocument | null; error: string | null };

export function isPdf(item: Pick<IntakeItem, "verified_mime" | "declared_mime">): boolean {
  return (item.verified_mime ?? item.declared_mime) === "application/pdf";
}

/** iPhone HEIC/HEIF photos have no preview (the server cannot decode HEVC); the original opens in a new tab. */
export function previewUnavailable(item: Pick<IntakeItem, "verified_mime" | "declared_mime">): boolean {
  const mime = item.verified_mime ?? item.declared_mime;
  return mime === "image/heic" || mime === "image/heif";
}

/** JPEG and PNG render as sent; WebP and TIFF come back as a PNG preview. */
export function needsServerPreview(item: Pick<IntakeItem, "verified_mime" | "declared_mime">): boolean {
  const mime = item.verified_mime ?? item.declared_mime;
  return mime !== "image/jpeg" && mime !== "image/png";
}

/**
 * Loads the original PDF once for the page preview and the split grid.
 * No scripting, no XFA and no annotation layer: the bytes are drawn onto
 * canvases and nothing in the PDF can run or link out.
 */
export function usePdfDocument(item: Pick<IntakeItem, "id" | "verified_mime" | "declared_mime"> | null, reloadKey = 0): PdfState {
  const [state, setState] = useState<PdfState>({ status: "idle", doc: null, error: null });
  const itemId = item?.id ?? null;
  const pdf = item ? isPdf(item) : false;

  useEffect(() => {
    if (!itemId || !pdf) return;
    let live = true;
    let task: { destroy: () => Promise<void> } | null = null;
    setState({ status: "loading", doc: null, error: null });
    void (async () => {
      try {
        const response = await fetch(sourceUrl({ id: itemId }), { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 403 ? "You do not have access to this original." : "The original could not be loaded.");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        if (!live) return;
        // Standard fonts are served from public/pdfjs (copied from pdfjs-dist) so
        // typed PDFs without embedded fonts still draw with the right glyphs.
        const loading = pdfjs.getDocument({ data, enableXfa: false, stopAtErrors: false, standardFontDataUrl: "/pdfjs/standard_fonts/" });
        task = loading;
        const loaded = await loading.promise;
        if (!live) return;
        setState({ status: "ready", doc: loaded, error: null });
      } catch (cause) {
        if (live) setState({ status: "error", doc: null, error: cause instanceof Error ? cause.message : "The original could not be shown." });
      }
    })();
    return () => {
      live = false;
      if (task) void task.destroy();
    };
  }, [itemId, pdf, reloadKey]);

  return state;
}

/** One PDF page drawn to a canvas when it scrolls near the viewport. */
export function PdfPageCanvas({ doc, pageNumber, cssWidth, label }: { doc: PdfDocument; pageNumber: number; cssWidth: number; label: string }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = holderRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || cssWidth <= 0) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let live = true;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const page = await doc.getPage(pageNumber);
        if (!live || !canvasRef.current) return;
        const base = page.getViewport({ scale: 1 });
        const ratio = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        task = page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE });
        await task.promise;
      } catch (cause) {
        if (live && !(cause instanceof Error && cause.name === "RenderingCancelledException")) setFailed(true);
      }
    })();
    return () => {
      live = false;
      task?.cancel();
    };
  }, [visible, doc, pageNumber, cssWidth]);

  return (
    <div ref={holderRef} className="relative w-full bg-muted/30">
      {failed ? (
        <p className="p-4 text-sm text-muted-foreground">Page {pageNumber} could not be drawn.</p>
      ) : (
        <canvas ref={canvasRef} role="img" aria-label={label} className="block h-auto w-full" />
      )}
    </div>
  );
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function SourcePreview({
  item,
  pdf,
  onRetry,
}: {
  item: Pick<IntakeItem, "id" | "original_filename" | "verified_mime" | "declared_mime" | "page_count">;
  pdf: PdfState;
  onRetry: () => void;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [imageFailed, setImageFailed] = useState(false);
  const pageCount = pdf.doc?.numPages ?? item.page_count ?? 0;

  return (
    <section aria-label="Original document" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Original</h2>
        <a
          href={sourceUrl(item)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open original
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <div ref={containerRef} className="min-h-64 overflow-hidden rounded-xl border border-border bg-card">
        {isPdf(item) ? (
          pdf.status === "error" ? (
            <div className="p-4">
              <AdminErrorState title="The original could not be shown" message={pdf.error ?? "Try again."} onRetry={onRetry} />
            </div>
          ) : pdf.status !== "ready" || !pdf.doc ? (
            <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading the original…
            </div>
          ) : (
            <ol className="flex flex-col gap-3 p-3" aria-label={`${pageCount} ${pageCount === 1 ? "page" : "pages"}`}>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <li key={n} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Page {n} of {pageCount}
                  </span>
                  <PdfPageCanvas doc={pdf.doc!} pageNumber={n} cssWidth={Math.max(0, width - 24)} label={`Page ${n} of ${item.original_filename}`} />
                </li>
              ))}
            </ol>
          )
        ) : previewUnavailable(item) || imageFailed ? (
          <div className="grid gap-2 p-4 text-sm">
            <p className="text-foreground">{imageFailed ? "The preview could not be shown." : "Preview isn’t available for this photo format."}</p>
            <a
              href={sourceUrl(item)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Download original
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- same-origin authorized stream; next/image would proxy and cache it
          <img
            src={sourceUrl(item, needsServerPreview(item))}
            alt={`Original: ${item.original_filename}`}
            className="block h-auto w-full"
            onError={() => setImageFailed(true)}
          />
        )}
      </div>
    </section>
  );
}
